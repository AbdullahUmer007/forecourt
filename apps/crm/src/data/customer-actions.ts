'use server';
import { requireSession } from '@/auth/session';
import { withSession } from './db';
import {
  applyCustomer,
  type CustomerInput,
  type CustomerOutcome,
} from './customers';
import { applyAppointment, type AppointmentInput } from './appointments';
import { ukAppointmentTime } from '@forecourt/domain/appointment-time';
import { revalidatePath } from 'next/cache';
export async function saveCustomer(form: FormData) {
  const session = await requireSession();
  const input = Object.fromEntries(
    [
      'id',
      'revision',
      'siteId',
      'firstName',
      'lastName',
      'email',
      'phone',
      'address',
      'postcode',
      'notes',
    ].map((k) => [k, String(form.get(k) ?? '')]),
  ) as unknown as CustomerInput;
  const result = await withSession(session, (tx) =>
    applyCustomer(tx, session, input),
  );
  if (result.ok) {
    revalidatePath('/customers');
    revalidatePath(`/customers/${result.id}`);
    revalidatePath('/leads');
    revalidatePath('/appointments');
  }
  return result;
}
export async function saveAppointment(form: FormData) {
  const session = await requireSession();
  const input = Object.fromEntries(
    [
      'id',
      'version',
      'contactId',
      'leadId',
      'siteId',
      'assignedTo',
      'startsAt',
      'duration',
      'purpose',
      'notes',
      'operation',
      'outcome',
    ].map((k) => [k, String(form.get(k) ?? '')]),
  ) as unknown as AppointmentInput;
  if (input.operation === 'save') {
    const at = ukAppointmentTime(String(form.get('localStart') ?? ''));
    if (!at)
      return {
        ok: false,
        error:
          'Choose a valid UK date and time. The clock-change hour cannot be booked; choose a time outside it.',
      };
    input.startsAt = at;
  }
  const result = await withSession(session, (tx) =>
    applyAppointment(tx, session, input),
  ).catch((error: unknown): CustomerOutcome => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23P01'
    )
      return {
        ok: false,
        error:
          'This staff member or customer already has an appointment at that time. Choose another slot.',
      };
    throw error;
  });
  if (result.ok) {
    revalidatePath('/appointments');
    revalidatePath(`/appointments/${result.id}`);
    revalidatePath(`/customers/${input.contactId}`);
  }
  return result;
}
