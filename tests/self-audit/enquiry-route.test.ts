import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderStaticPage } from '../../apps/site/src/render/static-page';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), submit: vi.fn(), render: vi.fn() }));
vi.mock('../../apps/site/src/request.js', () => ({ requireTenant: mocks.resolve }));
vi.mock('../../apps/site/src/data/enquiries.js', () => ({ submitEnquiry: mocks.submit }));
vi.mock('../../apps/site/src/pages.js', () => ({ staticPageResponse: mocks.render }));
import { postEnquiry } from '../../apps/site/src/enquiries';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue({ ok: true, tenant: { tenantId: 'resolved-dealer' } });
  mocks.submit.mockResolvedValue({ ok: true });
  mocks.render.mockImplementation((_request, _id, extras) => new Response('form', { status: extras.status ?? 200 }));
});
const request = (body = 'name=Buyer&email=buyer%40example.test&message=Hello', origin = 'https://dealer.test') =>
  new Request('https://dealer.test/enquiries', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body });

describe('public enquiry HTTP boundary', () => {
  it('uses the resolved tenant and redirects after a successful write', async () => {
    const response = await postEnquiry(request('name=Buyer&email=buyer%40example.test&message=Hello&tenantId=attacker'));
    expect(mocks.submit).toHaveBeenCalledWith('resolved-dealer', expect.objectContaining({ message: 'Hello' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/contact?sent=1');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects cross-site submissions and unknown hosts before writing', async () => {
    expect((await postEnquiry(request(undefined, 'https://attacker.test'))).status).toBe(403);
    mocks.resolve.mockResolvedValue({ ok: false, response: new Response('Unknown dealer', { status: 404 }) });
    expect((await postEnquiry(request())).status).toBe(404);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('bounds the request body and ignores the bot-trap submission', async () => {
    expect((await postEnquiry(request('message=' + 'x'.repeat(70000)))).status).toBe(400);
    expect((await postEnquiry(request('company_website=spam'))).status).toBe(303);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('retains values on an unsuccessful submission', async () => {
    mocks.submit.mockResolvedValue({ ok: false, error: 'Please check your email.' });
    expect((await postEnquiry(request())).status).toBe(422);
    expect(mocks.render).toHaveBeenCalledWith(expect.any(Request), 'contact', expect.objectContaining({
      formValues: expect.objectContaining({ name: 'Buyer', message: 'Hello' }), formError: 'Please check your email.',
    }));
  });
  it('renders a labelled no-JavaScript form and escapes submitted values', () => {
    const html = renderStaticPage({ id: 'contact', origin: 'https://dealer.test', dealer: { name: 'Test Motors', telephone: null, locality: null },
      formError: 'Check your question', formValues: { name: '"><script>alert(1)</script>', email: '', phone: '', message: '</textarea><script>alert(1)</script>', vehicle: 'AB12CDE' } });
    expect(html).toContain('action="/enquiries"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('maxlength="4000"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('shows confirmation without rendering another submission form', () => {
    const html = renderStaticPage({ id: 'contact', origin: 'https://dealer.test', dealer: { name: 'Test Motors', telephone: null, locality: null }, formOk: true });
    expect(html).toContain('Thank you for your enquiry');
    expect(html).not.toContain('action="/enquiries"');
    expect(html).toContain('content="noindex"');
  });
});


it('shows the full saved weekly schedule, including closed days', () => {
  const page = renderStaticPage({ id: 'contact', origin: 'https://dealer.test', dealer: {
    name: 'Test Motors', telephone: null, locality: null,
    openingHours: [{ days: ['Sunday'], opens: '12:00', closes: '16:00' }],
  } });
  expect(page).toContain('<dt>Wednesday</dt><dd>Closed</dd>');
  expect(page).toContain('<dt>Sunday</dt><dd>12pm – 4pm</dd>');
});
