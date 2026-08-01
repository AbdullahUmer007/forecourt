# Screen patterns

Six patterns cover almost every screen in the CRM. Use them; don't invent a seventh without a reason.

---

## 1. List / table page

Stock, contacts, leads, deals, invoices.

```
Page header:  Title · record count · [Saved view ▾] · [Export] · [+ Primary action]
Filter bar:   (sticky) chips for active filters · [Filters ▾] · search · density toggle
Table:        virtualised, sticky header, resizable + reorderable columns
Bulk bar:     appears on selection, anchored bottom-centre, with a count and an X
Footer:       pagination + "showing 1–50 of 1,284"
```

Rules:
- **Filter state lives in the URL.** Every view is shareable and back-button correct.
- Saved views per user, plus shared tenant views. Pinned views appear in the sidebar.
- Inline edit for the two or three fields people change constantly (price, status, assignee). Everything else opens the record.
- Row click opens the record; ⌘/Ctrl-click opens in a new tab. Never make the whole row a drag handle.
- Health flags render as chips in a dedicated column, not scattered across cells.
- Empty state: *"No vehicles match these filters."* + [Clear filters] + [Add a vehicle].
- Zero-records-ever state is different: *"Your stock list is empty. Add your first vehicle by entering its registration — we'll fill in the rest."* + [Add vehicle] + [Import from a spreadsheet].

## 2. Record page

Vehicle, contact, deal, lead.

```
Sticky header:  identity (photo/avatar · reg plate · title) · key facts · status badge
                · [secondary actions ▾] · [Primary action]
Tabs:           Overview · … · History
Body:           two columns — main content (2/3) + right rail (1/3)
Right rail:     related records, assigned to, quick actions, activity feed
```

Rules:
- The header stays visible on scroll and always shows identity + status + the primary action.
- **Every record page has a History tab** containing a single merged timeline of everything that happened. This is one of the most-used features in a dealership and is usually missing from competitors.
- Related records are always clickable, never plain text.
- Edits autosave with an explicit "Saved" indicator; destructive edits confirm.

## 3. Board page

Prep pipeline, sales pipeline.

```
Header:   view controls · column config · density toggle · totals per column
Columns:  stage name · count · aggregate value · SLA indicator
Cards:    photo/identity · 3 key facts · owner · age vs SLA ring · blocking flag
```

Rules:
- Drag between columns with an optimistic update and a rollback toast on failure.
- Required-field gates on advance: if a stage needs data, prompt for it inline rather than refusing silently.
- **Mobile: single column with a stage picker at the top**, not a horizontally-scrolling board. Horizontal scroll on a phone in a workshop is unusable.

## 4. Wizard

Onboarding, part-ex appraisal, deal build, finance journey.

```
Left:    step spine with completion state (never a hidden progress bar)
Right:   one step's content, one question group at a time
Footer:  [Back] · autosave indicator · [Save and exit] · [Continue]
```

Rules:
- **Never a modal.** Wizards lose work in modals.
- Drafts save continuously and are resumable from anywhere, including a different device.
- Steps are navigable backwards freely; forwards only when valid.
- On mobile, the spine collapses to "Step 3 of 7" with a tap-to-expand list.
- Compliance-bearing steps (initial disclosure, commission disclosure, contract formation) cannot be skipped and record their completion to the evidence ledger the moment they're satisfied — not at the end.

## 5. Dashboard

```
Hero figure:      exactly ONE per view, ≥40px, sans, with its period named
KPI tile row:     4–6 stat tiles, each with label · value · delta vs a named period · sparkline
Charts:           at most FOUR, each with a title that states the takeaway
Action lists:     "needs attention" — aged stock, unattended leads, overdue tasks
```

Rules:
- Every tile and every chart element is clickable through to the filtered records that produced it.
- Chart titles state the finding, not the axes: *"Days to sell fell 6 days this quarter"*, not *"Days to sell by month"*.
- Deltas name their comparison period explicitly: *"+12% vs last month"*, never a bare arrow.
- Role-specific dashboards, not one dashboard with role-based hiding. See functional spec §26.1.
- Mobile owner dashboard: six tiles, stacked, no charts. A dealer principal checks this at 7am on a phone.

## 6. Settings

```
Left:   grouped settings navigation, searchable
Right:  one group's form, sectioned, with a change-log link
```

Rules:
- Autosave with an explicit saved indicator; no "Save" button graveyard at the bottom of a long form.
- Every setting has helper text explaining what it affects and where.
- Settings that carry regulatory weight (VAT scheme default, FCA permission basis, consent wording, representative APR) show a warning and require confirmation, and are recorded in the audit log with before/after.

---

## Mobile shell

Bottom tab bar: **Today · Stock · Leads · [+ Add] · More**.

`+ Add` opens a full-screen action sheet: add vehicle (camera or reg) · log a lead · appraise a part-ex · add a cost · capture a photo set. Every one completable one-handed, offline, queued for sync.

Offline behaviour: capture works; a persistent banner shows "3 items waiting to sync"; conflicts on sync are surfaced for a human decision, never silently resolved.

---

## Public dealer website

### Vehicle detail page — above the fold on mobile, in this order

1. Photo gallery (swipe, tap for full screen)
2. Make · model · derivative
3. Price · finance-from (inside `<FinancePromotion>`)
4. Key specs: year · mileage · fuel · transmission
5. CTA row: Call · WhatsApp · Enquire · Reserve

Everything else below: full gallery · description · full specification accordion · MOT history with mileage chart · provenance badge · declared condition and damage photos · finance calculator · part-exchange widget · warranty and delivery · dealer trust block · similar vehicles.

Conversion details that punch above their weight:
- A **sticky mobile CTA bar** that never scrolls away
- The phone number as a real `tel:` link with click tracking
- A WhatsApp deep link with a pre-filled message naming the vehicle
- A **"request a video walkaround"** button — the cheapest high-converting feature we can ship
- A visible "reserve for £99" path that takes a real deposit

### Search results

Facets in a bottom sheet on mobile, a left rail on desktop. Facet counts always shown; zero-count options disabled, not hidden. Results update without a full page load but with real, shareable URLs. Skeleton cards match final dimensions — **never a spinner over an empty page, never layout shift**.

**Zero results is never a dead end**: show nearest matches, offer "notify me when something like this arrives" (which creates a wishlist lead), and log the search so it feeds the dealer's sourcing demand signals.

---

## Copy patterns

| Situation | Pattern |
|---|---|
| Empty list | State the emptiness plainly, then the single next action as a button |
| Error | What happened · why · what to do. Name the system that failed. |
| Destructive confirm | Name the object, state what is lost, require typed intent for irreversible actions |
| Loading | Skeleton matching final layout. Spinners only for actions under 1s. |
| Success | Toast, 4s, with an undo where undo is possible |
| Degraded integration | Name the provider, say what still works, say when we'll retry |
| Compliance blocker | Explain the rule, link to the source, offer the fix — never just "not allowed" |
