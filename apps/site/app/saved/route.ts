export function GET(): Response {
  return new Response(null, {
    status: 308,
    headers: { location: '/saved-cars' },
  });
}
