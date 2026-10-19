import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';

let directory;
let child;
let baseUrl;
let output = '';

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return {
    response,
    data,
    cookie: response.headers.getSetCookie().find((value) => value.startsWith('travel_expense_session='))?.split(';')[0],
  };
}

async function waitForServer() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${output}`);
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wayfarer-api-test-'));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(process.cwd(), 'server.js')], {
    cwd: directory,
    env: { ...process.env, PORT: String(port), DB_PATH: join(directory, 'test.sqlite'), ALLOW_REGISTRATION: 'true', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForServer();
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('users can create trips, manage stays and expenses, and cannot read each other’s records', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Wayfarer/);
  const appScript = await fetch(`${baseUrl}/app.js`);
  assert.equal(appScript.status, 200);
  const appScriptText = await appScript.text();
  assert.match(appScriptText, /Select a state or union territory/);
  assert.match(appScriptText, /In progress/);
  assert.match(appScriptText, /Upcoming/);
  assert.match(appScriptText, /Completed/);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'traveller', password: 'secure-password-123' },
  });
  assert.equal(registered.response.status, 201);
  const cookie = registered.cookie;
  assert.ok(cookie);
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'TRAVELLER', password: 'secure-password-123' },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.username, 'traveller');

  const otherUser = await request('/api/auth/register', {
    method: 'POST',
    body: { username: 'another-user', password: 'secure-password-123' },
  });
  assert.equal(otherUser.response.status, 201);
  const otherCookie = otherUser.cookie;

  const tripBody = {
    travelType: 'domestic',
    name: 'Work trip',
    destinationCity: 'Jaipur',
    destinationState: 'Rajasthan',
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    transportMode: 'train',
    notes: 'Conference',
  };
  const tripResponse = await request('/api/trips', { cookie, method: 'POST', body: tripBody });
  assert.equal(tripResponse.response.status, 201);
  const tripId = tripResponse.data.id;
  assert.equal((await request('/api/trips', { cookie: otherCookie })).data.trips.length, 0);
  assert.equal((await request(`/api/trips/${tripId}`, { cookie: otherCookie })).response.status, 404);

  const international = await request('/api/trips', { cookie, method: 'POST', body: { ...tripBody, travelType: 'international' } });
  assert.equal(international.response.status, 409);

  const hotel = await request(`/api/trips/${tripId}/stays`, { cookie, method: 'POST', body: {
    hotelName: 'City Hotel', address: 'MI Road', phone: '1234567890',
    bookingReference: 'ABC123', checkIn: '2026-11-02', checkOut: '2026-11-05', hotelAmount: 5200.75,
  } });
  assert.equal(hotel.response.status, 201);
  const updatedHotel = await request(`/api/trips/${tripId}/stays/${hotel.data.id}`, { cookie, method: 'PUT', body: {
    hotelName: 'City Hotel Jaipur', address: 'MI Road', phone: '1234567890',
    bookingReference: 'ABC123', checkIn: '2026-11-02', checkOut: '2026-11-05', hotelAmount: 6100.5,
  } });
  assert.equal(updatedHotel.response.status, 200);
  const invalidHotelAmount = await request(`/api/trips/${tripId}/stays`, { cookie, method: 'POST', body: {
    hotelName: 'Invalid amount', checkIn: '2026-11-02', checkOut: '2026-11-03', hotelAmount: -100,
  } });
  assert.equal(invalidHotelAmount.response.status, 400);
  const invalidHotel = await request(`/api/trips/${tripId}/stays`, { cookie, method: 'POST', body: {
    hotelName: 'Outside dates', checkIn: '2026-11-06', checkOut: '2026-11-07',
  } });
  assert.equal(invalidHotel.response.status, 400);

  const expense = await request(`/api/trips/${tripId}/expenses`, { cookie, method: 'POST', body: {
    expenseDate: '2026-11-03', category: 'food', description: 'Lunch', amount: 250.5, paymentMethod: 'UPI',
  } });
  assert.equal(expense.response.status, 201);
  const invalidExpense = await request(`/api/trips/${tripId}/expenses`, { cookie, method: 'POST', body: {
    expenseDate: '2026-11-07', category: 'fuel', description: 'Outside travel dates', amount: 500,
  } });
  assert.equal(invalidExpense.response.status, 400);
  const transport = await request(`/api/trips/${tripId}/transports`, { cookie, method: 'POST', body: {
    transportDate: '2026-11-04', mode: 'train', amount: 1800,
    details: {
      operator: 'Shatabdi Express', serviceNumber: '12015', startLocation: 'Jaipur Junction',
      endLocation: 'New Delhi', class: 'AC Chair Car', bookingReference: '123456',
    },
  } });
  assert.equal(transport.response.status, 201);
  const invalidTransport = await request(`/api/trips/${tripId}/transports`, { cookie, method: 'POST', body: {
    transportDate: '2026-11-04', mode: 'flight', amount: 1800,
    details: { operator: 'Air India', startLocation: 'Jaipur' },
  } });
  assert.equal(invalidTransport.response.status, 400);
  const carTransport = await request(`/api/trips/${tripId}/transports`, { cookie, method: 'POST', body: {
    mode: 'car', amount: 750, transportDate: '', details: { vehicleNumber: 'ignored', startLocation: 'ignored' },
  } });
  assert.equal(carTransport.response.status, 201);
  const carTransportDetails = await request(`/api/trips/${tripId}`, { cookie });
  const savedCarTransport = carTransportDetails.data.transports.find((item) => item.id === carTransport.data.id);
  assert.equal(savedCarTransport.transport_date, tripBody.startDate);
  assert.deepEqual(savedCarTransport.details, {});
  assert.equal((await request(`/api/trips/${tripId}/transports/${carTransport.data.id}`, { cookie, method: 'DELETE' })).response.status, 200);
  assert.equal((await request(`/api/trips/${tripId}/transports/${transport.data.id}`, {
    cookie: otherCookie, method: 'PUT', body: {
      transportDate: '2026-11-04', mode: 'train', amount: 1,
      details: { operator: 'Unauthorized', startLocation: 'Jaipur', endLocation: 'Delhi' },
    },
  })).response.status, 404);

  const detail = await request(`/api/trips/${tripId}`, { cookie });
  assert.equal(detail.data.trip.travel_type, 'domestic');
  assert.equal(detail.data.stays[0].hotel_name, 'City Hotel Jaipur');
  assert.equal(detail.data.stays[0].hotel_amount_paise, 610050);
  assert.equal(detail.data.expenses[0].amount_paise, 25050);
  assert.equal(detail.data.transports[0].details.serviceNumber, '12015');
  let tripList = await request('/api/trips', { cookie });
  assert.equal(tripList.data.trips[0].total_paise, 815100);
  assert.equal(tripList.data.trips[0].hotel_total_paise, 610050);
  assert.equal(tripList.data.trips[0].food_total_paise, 25050);
  assert.equal(tripList.data.trips[0].transport_total_paise, 180000);
  const annualReport = await request('/api/reports/annual?year=2026', { cookie });
  assert.equal(annualReport.response.status, 200);
  assert.equal(annualReport.data.totals.total_paise, 815100);
  assert.equal(annualReport.data.totals.hotel_paise, 610050);
  assert.equal(annualReport.data.totals.food_paise, 25050);
  assert.equal(annualReport.data.totals.transport_paise, 180000);
  assert.equal(annualReport.data.trips.length, 1);
  assert.equal((await request('/api/reports/annual?year=2026', { cookie: otherCookie })).data.trips.length, 0);
  assert.equal((await request('/api/reports/annual?year=invalid', { cookie })).response.status, 400);
  assert.equal((await request(`/api/trips/${tripId}/expenses/${expense.data.id}`, {
    cookie: otherCookie,
    method: 'PUT',
    body: { expenseDate: '2026-11-03', category: 'food', description: 'Unauthorized', amount: 1 },
  })).response.status, 404);

  const updatedTransport = await request(`/api/trips/${tripId}/transports/${transport.data.id}`, { cookie, method: 'PUT', body: {
    transportDate: '2026-11-04', mode: 'train', amount: 2000,
    details: {
      operator: 'Shatabdi Express', serviceNumber: '12015', startLocation: 'Jaipur Junction',
      endLocation: 'New Delhi', class: 'Executive Chair Car', bookingReference: '123456',
    },
  } });
  assert.equal(updatedTransport.response.status, 200);
  assert.equal((await request(`/api/trips/${tripId}`, { cookie })).data.transports[0].amount_paise, 200000);
  assert.equal((await request('/api/trips', { cookie })).data.trips[0].total_paise, 835100);

  const updated = await request(`/api/trips/${tripId}/expenses/${expense.data.id}`, {
    cookie, method: 'PUT', body: { expenseDate: '2026-11-03', category: 'food', description: 'Lunch with client', amount: 300 },
  });
  assert.equal(updated.response.status, 200);
  tripList = await request('/api/trips', { cookie });
  assert.equal(tripList.data.trips[0].total_paise, 840050);
  const updatedAnnualReport = await request('/api/reports/annual?year=2026', { cookie });
  assert.equal(updatedAnnualReport.data.totals.total_paise, 840050);
  const updatedTrip = await request(`/api/trips/${tripId}`, {
    cookie, method: 'PUT', body: { ...tripBody, name: 'Updated work trip', endDate: '2026-11-07' },
  });
  assert.equal(updatedTrip.response.status, 200);
  assert.equal((await request(`/api/trips/${tripId}`, { cookie })).data.trip.name, 'Updated work trip');
  const invalidTripDateChange = await request(`/api/trips/${tripId}`, {
    cookie, method: 'PUT', body: { ...tripBody, endDate: '2026-11-02' },
  });
  assert.equal(invalidTripDateChange.response.status, 409);
  const deletedTransport = await request(`/api/trips/${tripId}/transports/${transport.data.id}`, { cookie, method: 'DELETE' });
  assert.equal(deletedTransport.response.status, 200);
  assert.equal((await request('/api/trips', { cookie })).data.trips[0].total_paise, 640050);
  const earlierTrip = await request('/api/trips', { cookie, method: 'POST', body: {
    ...tripBody,
    name: 'Earlier trip',
    startDate: '2026-10-01',
    endDate: '2026-10-02',
  } });
  assert.equal(earlierTrip.response.status, 201);
  const orderedTrips = await request('/api/trips', { cookie });
  assert.deepEqual(orderedTrips.data.trips.map((trip) => trip.start_date), ['2026-10-01', '2026-11-02']);

  assert.equal((await request('/api/trips', { method: 'POST', body: tripBody })).response.status, 401);
});
