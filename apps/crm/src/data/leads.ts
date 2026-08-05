/**
 * The lead inbox.
 *
 * A lead is the only thing in this product with a clock that a competitor is
 * also racing. A marketplace buyer has enquired on four cars and is waiting
 * for whoever answers first, so the default order here is not "newest" — it is
 * "who is closest to being lost", which means unanswered leads by deadline,
 * most overdue first. Newest-first is the ordering every CRM ships and it is
 * wrong: it buries the enquiry from ninety minutes ago underneath the one from
 * ninety seconds ago.
 *
 * The SLA figures come from `slaState` in the domain, not from anything
 * re-implemented here — except the aggregate breach count, which has to be
 * counted in SQL because counting it in TypeScript means loading every open
 * lead to render one number. The two are asserted to agree in
 * `tests/integration/leads-inbox.test.ts`; the fallback minutes are
 * interpolated from `DEFAULT_SLA_MINUTES` so there is one place the numbers
 * live, the same reasoning as M10's `prepareOutbound` delegating to `canSend`.
 */

import { withSession, toDate, toInt, type Tx } from './db';
import type { Session } from '@/auth/session';
import {
  DEFAULT_SLA_MINUTES, slaState, summarisePipeline, lossAnalysis,
  canSend, normaliseDestination,
  type Lead, type LeadStage, type LeadSource, type LossReason, type SlaState,
  type ConsentRecord, type ConsentChannel, type SuppressionRecord,
} from '@forecourt/domain';

/** The channels a dealer actually reaches somebody on, in the order they'd try. */
const MARKETING_CHANNELS: readonly ConsentChannel[] = ['phone', 'email', 'sms', 'whatsapp', 'post'];

export interface LeadRow extends Lead {
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  vehicleRegistration: string | null;
  vehicleDescription: string | null;
  assignedToName: string | null;
  siteName: string | null;
  message: string | null;
  sla: SlaState;
}

export interface InboxFilters {
  // Optional AND undefined-able: these arrive from searchParams, where a
  // missing key IS undefined, and under exactOptionalPropertyTypes the two are
  // different types.
  q?: string | undefined;
  stage?: string | undefined;
  source?: string | undefined;
  /** 'me' | 'unassigned' | a user id | undefined for everyone. */
  assigned?: string | undefined;
  /** Unanswered and past the deadline only. */
  overdueOnly?: boolean | undefined;
  /** Open leads only. Default true — a closed lead is history, not an inbox. */
  includeClosed?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface InboxPage {
  rows: LeadRow[];
  total: number;
  /** Counts across the WHOLE open book, not the filtered page — the point of
   *  the strip at the top is to say what is waiting, not what is on screen. */
  summary: {
    byStage: Record<LeadStage, number>;
    open: number;
    breachedSla: number;
    unanswered: number;
    conversionRate: number | null;
  };
  sources: { source: LeadSource; count: number }[];
  queryMs: number;
}

/**
 * `due_at` in SQL, falling back the same way `slaDueAt` does.
 *
 * Older rows have no `due_at` — it was added by the writer, and a lead created
 * before the policy existed still has a deadline. The fallback minutes are
 * built from the domain constant rather than typed out, so changing a target
 * changes both the screen and this query.
 */
const dueAtSql = (tx: Tx) => {
  const cases = (Object.entries(DEFAULT_SLA_MINUTES) as [LeadSource, number][])
    .map(([source, minutes]) => tx`WHEN ${source} THEN ${minutes}`);
  return tx`coalesce(l.due_at, l.received_at + (
    (CASE l.source::text ${cases} ELSE 60 END) || ' minutes')::interval)`;
};

const OPEN = (tx: Tx) => tx`l.closed_at IS NULL`;

const rowToLead = (r: Record<string, unknown>): LeadRow => {
  const lead: Lead = {
    id: String(r['id']),
    tenantId: String(r['tenant_id']),
    contactId: String(r['contact_id']),
    vehicleId: r['vehicle_id'] === null ? null : String(r['vehicle_id']),
    source: r['source'] as LeadSource,
    sourceReference: r['source_reference'] === null ? null : String(r['source_reference']),
    stage: r['stage'] as LeadStage,
    assignedTo: r['assigned_to'] === null ? null : String(r['assigned_to']),
    receivedAt: toDate(r['received_at'] as Date) as Date,
    firstResponseAt: toDate(r['first_response_at'] as Date | null),
    dueAt: toDate(r['due_at_effective'] as Date | null),
    closedAt: toDate(r['closed_at'] as Date | null),
    lossReason: (r['loss_reason'] as LossReason | null) ?? null,
    lossDetail: r['loss_detail'] === null ? null : String(r['loss_detail']),
    lostTo: r['lost_to'] === null ? null : String(r['lost_to']),
  };

  const first = r['first_name'] as string | null;
  const last = r['last_name'] as string | null;
  const company = r['company_name'] as string | null;
  // A lead can lawfully arrive as an email address and nothing else — M9
  // refuses to require a name precisely so nobody types "Unknown". So the
  // fallback is the email, then the phone, and only then a stated absence.
  const contactName = [first, last].filter(Boolean).join(' ')
    || company
    || (r['email'] as string | null)
    || (r['phone'] as string | null)
    || 'No name given';

  return {
    ...lead,
    contactName,
    contactEmail: (r['email'] as string | null) ?? null,
    contactPhone: (r['phone'] as string | null) ?? null,
    vehicleRegistration: (r['registration'] as string | null) ?? null,
    vehicleDescription: [r['make'], r['model'], r['derivative']]
      .filter(Boolean).join(' ') || null,
    assignedToName: (r['assigned_name'] as string | null) ?? null,
    siteName: (r['site_name'] as string | null) ?? null,
    message: (r['message'] as string | null) ?? null,
    sla: slaState(lead, new Date()),
  };
};

export async function loadInbox(
  session: Session,
  filters: InboxFilters,
): Promise<InboxPage> {
  const started = Date.now();
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const page = await withSession(session, async (tx) => {
    const due = dueAtSql(tx);

    // Built as named fragments so an absent filter contributes nothing at all,
    // rather than a `1=1` the planner has to reason about. Named rather than
    // an array because indexing one gives `T | undefined`, which the query
    // builder rejects — and rightly: a hole in a WHERE clause is not a filter
    // that does nothing, it is a syntax error.
    const wOpen = filters.includeClosed ? tx`TRUE` : OPEN(tx);
    const wStage = filters.stage ? tx`AND l.stage = ${filters.stage}::lead_stage` : tx``;
    const wSource = filters.source ? tx`AND l.source = ${filters.source}::lead_source` : tx``;
    const wAssigned = filters.assigned === 'unassigned' ? tx`AND l.assigned_to IS NULL`
      : filters.assigned === 'me' ? tx`AND l.assigned_to = ${session.userId}::uuid`
        : filters.assigned ? tx`AND l.assigned_to = ${filters.assigned}::uuid`
          : tx``;
    const wOverdue = filters.overdueOnly
      ? tx`AND l.first_response_at IS NULL AND ${due} < now()`
      : tx``;
    // plainto_tsquery, not to_tsquery: the latter throws on the ampersand
    // somebody will type, and a search box that 500s on "R&D" is a bug
    // waiting for a Tuesday.
    const wSearch = filters.q
      ? tx`AND (
          to_tsvector('english',
            coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'') || ' ' ||
            coalesce(c.company_name,'') || ' ' || coalesce(c.email,'') || ' ' ||
            coalesce(l.message,''))
            @@ plainto_tsquery('english', ${filters.q})
          OR c.phone ILIKE ${'%' + filters.q + '%'}
          OR v.registration ILIKE ${'%' + filters.q.replace(/\s+/g, '') + '%'}
        )`
      : tx``;

    const rows = await tx`
      SELECT l.*, ${due} AS due_at_effective,
             c.first_name, c.last_name, c.company_name, c.email, c.phone,
             v.registration, v.make, v.model, v.derivative,
             u.name AS assigned_name, s.name AS site_name
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id
      LEFT JOIN vehicles v ON v.id = l.vehicle_id
      LEFT JOIN users u ON u.id = l.assigned_to
      LEFT JOIN sites s ON s.id = l.site_id
      WHERE ${wOpen} ${wStage} ${wSource} ${wAssigned} ${wOverdue} ${wSearch}
      ORDER BY
        -- Needs-attention order. An unanswered lead outranks an answered one
        -- whatever the timestamps say, and within that the soonest deadline
        -- (or the largest overrun) is first.
        (l.first_response_at IS NOT NULL) ASC,
        CASE WHEN l.first_response_at IS NULL THEN ${due} END ASC NULLS LAST,
        l.received_at DESC
      LIMIT ${limit} OFFSET ${offset}`;

    const [counted] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id
      LEFT JOIN vehicles v ON v.id = l.vehicle_id
      WHERE ${wOpen} ${wStage} ${wSource} ${wAssigned} ${wOverdue} ${wSearch}`;

    // The strip at the top: the whole book, unfiltered, because "you have six
    // overdue" must not change when somebody filters to one salesperson.
    const stages = await tx<{ stage: LeadStage; n: number }[]>`
      SELECT stage, count(*)::int AS n FROM leads GROUP BY stage`;

    const [sla] = await tx<{ breached: number; unanswered: number }[]>`
      SELECT
        count(*) FILTER (WHERE ${due} < now())::int AS breached,
        count(*)::int AS unanswered
      FROM leads l
      WHERE l.first_response_at IS NULL AND l.closed_at IS NULL`;

    const sources = await tx<{ source: LeadSource; n: number }[]>`
      SELECT source, count(*)::int AS n
      FROM leads l WHERE ${filters.includeClosed ? tx`TRUE` : OPEN(tx)}
      GROUP BY source ORDER BY count(*) DESC`;

    const byStage = {
      new: 0, contacted: 0, qualified: 0, appointment: 0,
      test_drive: 0, negotiating: 0, won: 0, lost: 0,
    } as Record<LeadStage, number>;
    for (const s of stages) byStage[s.stage] = s.n;
    const closed = byStage.won + byStage.lost;

    return {
      rows: rows.map((r) => rowToLead(r as Record<string, unknown>)),
      total: counted?.n ?? 0,
      summary: {
        byStage,
        open: Object.values(byStage).reduce((a, b) => a + b, 0) - closed,
        breachedSla: sla?.breached ?? 0,
        unanswered: sla?.unanswered ?? 0,
        // Null rather than 0% when nothing has closed. 0% reads as failure
        // where the truth is "no data yet", and a dealer principal who sees
        // that on a Monday stops believing the rest of the screen.
        conversionRate: closed === 0 ? null : byStage.won / closed,
      },
      sources: sources.map((s) => ({ source: s.source, count: s.n })),
    };
  });

  return { ...page, queryMs: Date.now() - started };
}

// ----------------------------------------------------------------- one lead

export interface LeadEvent {
  id: string;
  kind: string;
  fromStage: LeadStage | null;
  toStage: LeadStage | null;
  detail: string | null;
  occurredAt: Date;
  actorName: string | null;
}

export interface LeadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  subject: string | null;
  body: string;
  isMarketing: boolean;
  status: string;
  blockedReason: string | null;
  occurredAt: Date;
}

export interface LeadDetail extends LeadRow {
  contactPostcode: string | null;
  events: LeadEvent[];
  messages: LeadMessage[];
  /** What may be sent on each channel, AS AT now, through the same gate a send
   *  job uses. Both answers are shown, because they differ and the difference
   *  is the whole point: replying to somebody's enquiry is a service message
   *  and needs no consent, offering them a different car is marketing and
   *  does. A screen showing only "no consent" teaches staff not to reply. */
  consent: {
    channel: ConsentChannel;
    destination: string | null;
    marketing: { permitted: boolean; reason: string };
    service: { permitted: boolean; reason: string };
  }[];
  /** Other open leads from the same person. Four enquiries from one buyer is
   *  one buyer, and ringing them four times is how you lose them. */
  otherOpenLeads: { id: string; stage: LeadStage; receivedAt: Date; registration: string | null }[];
}

export async function loadLead(
  session: Session,
  id: string,
): Promise<LeadDetail | null> {
  return withSession(session, async (tx) => {
    const due = dueAtSql(tx);

    const [row] = await tx`
      SELECT l.*, ${due} AS due_at_effective,
             c.first_name, c.last_name, c.company_name, c.email, c.phone,
             c.postcode, c.address_line1, c.erased_at,
             v.registration, v.make, v.model, v.derivative,
             u.name AS assigned_name, s.name AS site_name
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id
      LEFT JOIN vehicles v ON v.id = l.vehicle_id
      LEFT JOIN users u ON u.id = l.assigned_to
      LEFT JOIN sites s ON s.id = l.site_id
      WHERE l.id = ${id}::uuid`;

    if (!row) return null;
    const lead = rowToLead(row as Record<string, unknown>);

    const [events, messages, consents, suppressions, others] = await Promise.all([
      tx`SELECT e.*, u.name AS actor_name FROM lead_events e
         LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.lead_id = ${id}::uuid ORDER BY e.occurred_at ASC`,
      tx`SELECT * FROM messages WHERE lead_id = ${id}::uuid ORDER BY occurred_at ASC`,
      // The consent HISTORY, not a current-state column — M9 stores an
      // append-only record and derives the position at a stated moment.
      tx`SELECT * FROM contact_consents WHERE contact_id = ${lead.contactId}::uuid
         ORDER BY recorded_at ASC`,
      // Suppression works on a destination, not on a contact: somebody
      // forwarded a marketing email and their friend clicked unsubscribe.
      tx`SELECT channel, destination, active, created_at FROM suppressions`,
      tx`SELECT l.id, l.stage, l.received_at, v.registration
         FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id
         WHERE l.contact_id = ${lead.contactId}::uuid
           AND l.id <> ${id}::uuid AND l.closed_at IS NULL
         ORDER BY l.received_at DESC LIMIT 10`,
    ]);

    // Answered through `canSend` — the same gate the send job uses — rather
    // than by reading the latest row here. Re-deriving "may we contact them?"
    // on a screen is how the screen and the sender come to disagree, and the
    // one that is wrong is always the one nobody tested. Expiry, withdrawal,
    // suppression and erasure all live in there.
    const now = new Date();
    const history: ConsentRecord[] = consents.map((c) => ({
      id: String(c['id']),
      tenantId: String(c['tenant_id']),
      contactId: String(c['contact_id']),
      channel: c['channel'] as ConsentChannel,
      basis: c['basis'] as ConsentRecord['basis'],
      granted: Boolean(c['granted']),
      source: c['source'] as ConsentRecord['source'],
      wordingId: c['wording_id'] === null ? null : String(c['wording_id']),
      evidence: (c['evidence'] as string | null) ?? null,
      sourceDetail: (c['source_detail'] as string | null) ?? null,
      expiresAt: toDate(c['expires_at'] as Date | null),
      recordedAt: toDate(c['recorded_at'] as Date) as Date,
      recordedBy: c['recorded_by'] === null ? null : String(c['recorded_by']),
    }));

    const suppressed: SuppressionRecord[] = suppressions.map((s) => ({
      channel: s['channel'] as ConsentChannel,
      destination: String(s['destination']),
      active: Boolean(s['active']),
      createdAt: toDate(s['created_at'] as Date) as Date,
    }));

    const erased = toDate(row['erased_at'] as Date | null) !== null;

    const destinationFor = (channel: ConsentChannel): string | null => {
      if (channel === 'email') return lead.contactEmail;
      if (channel !== 'post') return lead.contactPhone;
      // A postcode is not an address. Treating one as a postal destination
      // made the panel say we could write to somebody we have no street
      // address for, which is the screen answering a question it does not
      // actually know the answer to.
      const line1 = row['address_line1'] as string | null;
      const postcode = row['postcode'] as string | null;
      return line1 && postcode ? `${line1}, ${postcode}` : null;
    };

    return {
      ...lead,
      contactPostcode: (row['postcode'] as string | null) ?? null,
      events: events.map((e) => ({
        id: String(e['id']),
        kind: String(e['kind']),
        fromStage: (e['from_stage'] as LeadStage | null) ?? null,
        toStage: (e['to_stage'] as LeadStage | null) ?? null,
        detail: (e['detail'] as string | null) ?? null,
        occurredAt: toDate(e['occurred_at'] as Date) as Date,
        actorName: (e['actor_name'] as string | null) ?? null,
      })),
      messages: messages.map((m) => ({
        id: String(m['id']),
        direction: m['direction'] as 'inbound' | 'outbound',
        channel: String(m['channel']),
        subject: (m['subject'] as string | null) ?? null,
        body: String(m['body']),
        isMarketing: Boolean(m['is_marketing']),
        status: String(m['status']),
        blockedReason: (m['blocked_reason'] as string | null) ?? null,
        occurredAt: toDate(m['occurred_at'] as Date) as Date,
      })),
      consent: MARKETING_CHANNELS.map((channel) => {
        const destination = destinationFor(channel);
        const gate = (kind: 'marketing' | 'service') => {
          if (!destination) {
            return { permitted: false, reason: `no ${channel} address on record` };
          }
          const decision = canSend({
            kind, channel, destination: normaliseDestination(channel, destination),
            consentHistory: history, suppressions: suppressed,
            sentAt: now, contactErased: erased,
          });
          return { permitted: decision.send, reason: decision.reason };
        };
        return {
          channel, destination,
          marketing: gate('marketing'),
          service: gate('service'),
        };
      }),
      otherOpenLeads: others.map((o) => ({
        id: String(o['id']),
        stage: o['stage'] as LeadStage,
        receivedAt: toDate(o['received_at'] as Date) as Date,
        registration: (o['registration'] as string | null) ?? null,
      })),
    };
  });
}

/** Everyone a lead can be assigned to. */
export async function loadAssignees(
  session: Session,
): Promise<{ id: string; name: string }[]> {
  return withSession(session, async (tx) => {
    const rows = await tx<{ id: string; name: string }[]>`
      SELECT u.id, u.name FROM users u
      JOIN tenant_memberships m ON m.user_id = u.id
      WHERE m.status = 'active' ORDER BY u.name`;
    return rows.map((r) => ({ id: r.id, name: r.name }));
  });
}

/**
 * The loss report — why deals are being lost, most costly first.
 *
 * This is what the mandatory loss reason exists to produce. "You lost eleven
 * deals on part-exchange valuations last month" is a buying instruction; the
 * same eleven with no reason recorded is nothing at all.
 */
export async function loadLossAnalysis(
  session: Session,
  sinceDays: number,
): Promise<{ reason: LossReason; label: string; count: number }[]> {
  return withSession(session, async (tx) => {
    const rows = await tx`
      SELECT l.* FROM leads l
      WHERE l.stage = 'lost'
        AND l.closed_at >= now() - (${sinceDays} || ' days')::interval`;
    // Counted by the domain rather than by SQL, so the labels and the ordering
    // are the same ones the rest of the product uses.
    return lossAnalysis(rows.map((r) => rowToLead(r as Record<string, unknown>)));
  });
}

/** Exposed for the test that asserts the SQL breach count and the domain agree. */
export async function loadOpenLeadsForCheck(session: Session): Promise<Lead[]> {
  return withSession(session, async (tx) => {
    const due = dueAtSql(tx);
    const rows = await tx`
      SELECT l.*, ${due} AS due_at_effective,
             NULL::text AS first_name, NULL::text AS last_name,
             NULL::text AS company_name, NULL::text AS email, NULL::text AS phone,
             NULL::text AS registration, NULL::text AS make, NULL::text AS model,
             NULL::text AS derivative, NULL::text AS assigned_name, NULL::text AS site_name
      FROM leads l WHERE l.closed_at IS NULL`;
    return rows.map((r) => rowToLead(r as Record<string, unknown>));
  });
}

export { summarisePipeline, toInt };
