# Customers and appointments
Staff at a desk or on the forecourt need searchable customer profiles and an appointment diary linked to enquiries. Existing contacts remain the customer source. New appointments store tenant/site, customer, optional lead, staff member, UTC start/end, purpose, status and revision. Audits retain every mutation; nothing sends a message or changes consent, money or vehicle state. Customer edits reject stale versions and erased/merged records. Contact destinations with permission history are protected until a verified destination-change workflow exists.

Acceptance: searchable/create/edit customer profiles with linked enquiries; create/reschedule/complete/cancel/no-show appointments; reject overlapping staff bookings, invalid times and stale edits; enforce tenant/site/permission boundaries; show UK-time day list and preserve form errors. Appointments inherit lead.read/lead.update permissions. Migration 0030 adds the table and composite tenant references; rollback app code while retaining appointment/audit data.


## Delivered locally
- Customer directory with scoped search and pagination; create/edit profiles, duplicate-destination warnings, permission checks and stale-edit protection.
- Profiles connect recent enquiries and appointments. Sales enquiry detail links to the customer and a pre-linked booking form.
- Daily appointment diary with UK dates, previous/next day navigation, personal filter, scheduled/closed counts and clear empty states.
- Viewing, test-drive, collection and meeting bookings with customer/site/staff, notes and optional enquiry; reschedule and record completed/cancelled/no-show outcomes. History and before/after audits remain.
- Native responsive forms preserve entries on error. The sidebar includes customer and calendar destinations, with mobile layouts, readable statuses and separate detail/outcome sections.
- Server converts UK wall-clock input to UTC. Invalid dates, DST gaps and ambiguous repeated hours are refused. Database exclusion constraints in migration 0031 prevent customer/staff overlaps across sites, including rows the caller cannot read. Collision responses disclose no other appointment details.

## Verification
- 1,798 tests across 62 files passed against local PostgreSQL, including 9 customer/appointment integration cases, UK-time unit cases and the extended cross-tenant gate.
- Database policy verification: all 103 tables protected (93 tenant-scoped and 10 special).
- Lint and TypeScript checks passed. CRM Docker production build passed; native Windows standalone symlink limitation avoided with Linux Docker.
- Local sales-user browser flow: create customer, book a test drive, reschedule from 10:30 to 11:30 UK, cancel with a reason, verify retained history, reject a past-time booking with notes preserved, then book a valid viewing and find it in the correct UK-day diary.
- axe-core 4.13 WCAG A/AA checks: no violations on directory, create/profile screens, daily diary, customer chooser, booking form and closed detail at a 375px frame (360px content with scrollbar where applicable). Booking and active detail also checked at 1440px. No horizontal overflow. These automated checks do not replace a full assistive-technology audit.
- Temporary browser QA files removed. One clearly named local test customer has a scheduled viewing on 14 September and a cancelled test-drive history on 15 September. No production records or outbound messages were changed.

## Deployment and rollback
Apply migrations 0030 and 0031 before deploying CRM. PostgreSQL must permit the btree_gist extension used by booking constraints; verify this on Railway during deployment preparation. Both migrations applied successfully to the two isolated local databases. Roll back application code first and retain appointment/audit records and conflict constraints; supplied down migrations intentionally preserve data. No Railway deployment has been performed.

## Remaining boundaries
This is the operational customer/appointment slice, not a claim that the entire CRM is finished. Recurring bookings, external-calendar sync, automated reminders, opening-hours/resource constraints, full historical pagination, customer merging/import, and an end-to-end data-subject request workflow remain separate work. Changing an email/phone with existing communication-permission history is deliberately refused until a verified destination-change workflow is implemented; other profile edits still work. No consent is granted by creating or editing a customer. Website/media/provider and other existing backlog items remain as recorded in earlier reports.
