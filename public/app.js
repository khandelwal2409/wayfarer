const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = { user: null, trips: [], section: null, domesticView: 'trips', reportYear: new Date().getFullYear(), annualReport: null, trip: null, calendarOffset: 0, showTripForm: false, editingExpense: null, editingStay: null, editingTransport: null, openSections: { hotels: false, transports: false, expenses: false }, authMode: 'login' };
let toastTimeout;
const transportModes = [
  ['car', 'Car'], ['train', 'Train'], ['bus', 'Bus'], ['flight', 'Flight'],
  ['taxi', 'Taxi'], ['two-wheeler', 'Two-wheeler'], ['other', 'Other'],
];
const transportFieldDefinitions = {
  car: [],
  'two-wheeler': [
    ['vehicleNumber', 'Vehicle number'], ['startLocation', 'From', true], ['endLocation', 'To', true], ['distanceKm', 'Distance (km)', false, true],
  ],
  flight: [
    ['operator', 'Airline', true], ['serviceNumber', 'Flight number'], ['startLocation', 'Departure airport', true],
    ['endLocation', 'Arrival airport', true], ['bookingReference', 'PNR / booking reference'],
  ],
  train: [
    ['operator', 'Train name', true], ['serviceNumber', 'Train number'], ['startLocation', 'From station', true],
    ['endLocation', 'To station', true], ['class', 'Coach / class'], ['bookingReference', 'PNR'],
  ],
  bus: [
    ['operator', 'Bus operator'], ['startLocation', 'From', true], ['endLocation', 'To', true], ['bookingReference', 'Booking reference'],
  ],
  taxi: [
    ['operator', 'Taxi provider'], ['startLocation', 'Pickup location', true], ['endLocation', 'Drop-off location', true], ['vehicleNumber', 'Vehicle number'],
  ],
  other: [
    ['operator', 'Operator / provider'], ['startLocation', 'From'], ['endLocation', 'To'], ['bookingReference', 'Booking reference'],
  ],
};
const indianStatesAndTerritories = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
  'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh',
  'Lakshadweep', 'Puducherry',
];

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const money = (paise) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format((Number(paise) || 0) / 100);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateLabel = (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date unavailable';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', options).format(date);
};
const tripStatus = (trip) => {
  if (trip.end_date < today()) return { label: 'Completed', className: 'completed' };
  if (trip.start_date > today()) return { label: 'Upcoming', className: 'upcoming' };
  return { label: 'In progress', className: 'in-progress' };
};
const statusBadge = (trip) => {
  const status = tripStatus(trip);
  return `<span class="trip-status ${status.className}">${status.label}</span>`;
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      state.user = null;
      state.trip = null;
      render();
    }
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2800);
}

function shell(content, { title = 'Tripzy', back = false } = {}) {
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="brand-lockup"><img class="brand-icon" src="/icon.svg" alt=""><span>${esc(title)}</span></div>
      <div class="top-actions">
        ${state.user ? `<span class="user-tag">${esc(state.user.username)}</span><button class="button secondary small" data-action="logout">Sign out</button>` : ''}
        ${back ? '<button class="button secondary small" data-action="back">All trips</button>' : ''}
      </div>
    </header>
    <main class="content">${content}</main>
  </div>`;
}

function renderAuth() {
  app.innerHTML = `<div class="auth-page">
    <section class="auth-hero">
      <div class="brand"><img class="brand-icon" src="/icon.svg" alt=""><h1>Tripzy</h1></div>
      <div><p class="eyebrow hero-eyebrow">Travel, accounted for</p><h2>Keep the trip. Not the receipts pile.</h2><p>One simple place for your itinerary, hotel stays, and everyday travel expenses.</p></div>
      <p class="hero-foot">A pocket-sized domestic travel ledger</p>
    </section>
    <section class="auth-form-wrap"><div class="auth-form">
      <h2>${state.authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
      <p class="muted">${state.authMode === 'login' ? 'Sign in to continue your travel log.' : 'Start keeping your travel records in one place.'}</p>
      <div class="tabs"><button class="${state.authMode === 'login' ? 'active' : ''}" data-action="auth-login">Sign in</button><button class="${state.authMode === 'register' ? 'active' : ''}" data-action="auth-register">Create account</button></div>
      <form class="form-stack" data-form="auth">
        <label class="field"><span>Username</span><input name="username" required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none"></label>
        <label class="field"><span>Password</span><input name="password" type="password" required minlength="${state.authMode === 'register' ? 10 : 1}" maxlength="128" autocomplete="${state.authMode === 'login' ? 'current-password' : 'new-password'}"></label>
        <button class="button" type="submit">${state.authMode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </div></section>
  </div>`;
}

function renderTravelType() {
  shell(`<p class="eyebrow">Your travel workspace</p><h1 class="heading">Where are you travelling?</h1>
    <p class="subheading">Choose a travel type to open its itinerary and expense rules.</p>
    <div class="grid type-grid">
      <button class="type-card" data-action="domestic">
        <span class="type-icon" aria-hidden="true">◉</span><h2>Domestic travel</h2>
        <p>Track trips within India, dates, hotel stays, transport, food, fuel, and other expenses.</p>
        <span class="button">Open domestic trips</span>
      </button>
      <button class="type-card" data-action="international">
        <span class="type-icon" aria-hidden="true">◎</span><h2>International travel</h2>
        <p>Different currency and travel rules will be handled in a future release.</p>
        <span class="category">Coming soon</span>
      </button>
    </div>`, { title: 'Choose travel type' });
}

function renderInternational() {
    shell(`<p class="eyebrow">International travel</p><h1 class="heading">International travel is coming soon.</h1>
      <p class="subheading">This section will use its own currency and travel rules. For now, no international expense records can be created.</p>
      <button class="button" data-action="change-type">Choose another travel type</button>`, { title: 'International travel' });
}

function tripForm() {
  return `<section class="panel">
    <h2 class="form-title">Plan a domestic trip</h2>
    <p class="muted">Add the dates and key travel details. You can update them as plans change.</p>
    <form class="form-stack" data-form="trip">
      <div class="field-row">
        <label class="field"><span>Trip name</span><input name="name" required maxlength="100" placeholder="Client visit, family trip..."></label>
        <label class="field"><span>Destination city</span><input name="destinationCity" required maxlength="100" placeholder="e.g. Jaipur"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>State / union territory</span><select name="destinationState" required>
          <option value="" disabled selected>Select a state or union territory</option>
          ${indianStatesAndTerritories.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
        </select></label>
        <label class="field"><span>Mode of transport</span><select name="transportMode" required>
          <option value="car">Car</option><option value="train">Train</option><option value="bus">Bus</option><option value="flight">Flight</option><option value="taxi">Taxi</option><option value="two-wheeler">Two-wheeler</option><option value="other">Other</option>
        </select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Departure date</span><input name="startDate" type="date" required value="${today()}"></label>
        <label class="field"><span>Return date</span><input name="endDate" type="date" required value="${today()}"></label>
      </div>
      <label class="field"><span>Trip notes <small class="muted">(optional)</small></span><textarea name="notes" maxlength="2000" placeholder="Purpose, itinerary notes, reminders..."></textarea></label>
      <div class="actions"><button class="button" type="submit">Create trip</button><button class="button secondary" type="button" data-action="cancel-trip">Cancel</button></div>
    </form>
  </section>`;
}

function domesticTabs() {
  return `<div class="dashboard-tabs" role="tablist" aria-label="Domestic travel views">
    <button class="button ${state.domesticView === 'trips' ? '' : 'secondary'}" role="tab" aria-selected="${state.domesticView === 'trips'}" data-action="show-trips">Trips</button>
    <button class="button ${state.domesticView === 'report' ? '' : 'secondary'}" role="tab" aria-selected="${state.domesticView === 'report'}" data-action="show-report">Annual report</button>
  </div>`;
}

function tripBreakdown(trip) {
  const amounts = [
    ['Hotel', trip.hotel_total_paise],
    ['Food', trip.food_total_paise],
    ['Fuel', trip.fuel_total_paise],
    ['Transport', trip.transport_total_paise],
    ['Other', trip.other_total_paise],
  ].filter(([, amount]) => amount > 0);
  return amounts.length
    ? `<div class="trip-breakdown">${amounts.map(([label, amount]) => `<span class="trip-breakdown-card"><small>${label}</small><strong>${money(amount)}</strong></span>`).join('')}</div>`
    : '<span class="trip-breakdown-empty">No expenses recorded yet</span>';
}

function transportFieldsMarkup(mode, details = {}) {
  return transportFieldDefinitions[mode].map(([name, label, required = false, numeric = false]) => `
    <label class="field"><span>${label}${required ? '' : ' <small class="muted">(optional)</small>'}</span>
      <input name="detail-${name}" ${numeric ? 'type="number" min="0.1" max="1000000" step="0.1"' : 'type="text" maxlength="120"'}
        ${required ? 'required' : ''} value="${esc(details[name] ?? '')}"${numeric ? ' placeholder="0"' : ''}>
    </label>`).join('');
}

function transportCommonFields(trip, mode, date, amount = '') {
  return `<div class="field-row transport-common-fields">
    ${mode === 'car' ? '' : `
      <label class="field"><span>Date</span><input name="transportDate" type="date" required min="${trip.start_date}" max="${trip.end_date}" value="${esc(date)}"></label>`}
    <label class="field"><span>Amount (INR)</span><input name="amount" type="number" required min="0.01" max="10000000" step="0.01" value="${esc(amount)}" placeholder="0.00"></label>
  </div>`;
}

function transportForm(tripData) {
  const { trip, transports } = tripData;
  const existing = state.editingTransport ? transports.find((item) => item.id === state.editingTransport) : null;
  const mode = existing?.mode || trip.transport_mode;
  const details = existing?.details || {};
  const date = today() < trip.start_date || today() > trip.end_date ? trip.start_date : today();
  return `<form class="form-stack" data-form="transport" data-id="${existing?.id || ''}">
    <h3 class="form-title">${existing ? 'Update transport' : 'Add transport'}</h3>
    <label class="field"><span>Mode of transport</span><select name="mode" data-field="transport-mode" required>
      ${transportModes.map(([value, label]) => `<option value="${value}" ${mode === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label>
    ${transportCommonFields(trip, mode, existing?.transport_date || date, existing ? (existing.amount_paise / 100).toFixed(2) : '')}
    <div class="field-row transport-detail-fields">${transportFieldsMarkup(mode, details)}</div>
    <div class="actions"><button class="button" type="submit">${existing ? 'Save transport' : 'Add transport'}</button>${existing ? '<button class="button secondary" type="button" data-action="cancel-transport">Cancel edit</button>' : ''}</div>
  </form>`;
}

function transportDetails(transport) {
  const labels = Object.fromEntries(transportFieldDefinitions[transport.mode].map(([name, label]) => [name, label]));
  return Object.entries(transport.details).map(([name, value]) => `${labels[name]}: ${esc(value)}`).join(' · ');
}

function renderTrips() {
  const cards = state.trips.map((trip) => `<button class="trip-card" data-action="open-trip" data-id="${trip.id}">
    <p class="eyebrow">${esc(trip.destination_city)}, ${esc(trip.destination_state)}</p>
    <div class="trip-card-heading"><h3>${esc(trip.name)}</h3>${statusBadge(trip)}</div>
    <p>${dateLabel(trip.start_date)} – ${dateLabel(trip.end_date)}</p>
    <p>${esc(trip.transport_mode.replace('-', ' '))} · ${trip.expense_count} expense${trip.expense_count === 1 ? '' : 's'}</p>
    ${tripBreakdown(trip)}
    <div class="trip-total">${money(trip.total_paise)}</div>
    <p>Total trip spend</p>
  </button>`).join('');
  shell(`<p class="eyebrow">Domestic travel · India</p><h1 class="heading">Your trips, in one place.</h1>
    <p class="subheading">Log expenses as you travel. You can edit trip details and records at any time.</p>
    ${domesticTabs()}
    <div class="actions"><button class="button" data-action="new-trip">${state.showTripForm ? 'Hide trip form' : '＋ Plan a trip'}</button><button class="button secondary" data-action="change-type">Travel types</button></div>
    ${state.showTripForm ? `<div class="spaced-top">${tripForm()}</div>` : ''}
    <div class="section-head"><div><h2>Domestic trips</h2><p>${state.trips.length} trip${state.trips.length === 1 ? '' : 's'} in your log</p></div></div>
    ${cards ? `<div class="grid trip-grid">${cards}</div>` : '<div class="empty">Your travel log is ready. Plan your first domestic trip to start recording its itinerary and expenses.</div>'}`, { title: 'Domestic trips' });
}

function renderAnnualReport() {
  const report = state.annualReport;
  const categories = [
    ['Hotel', report.totals.hotel_paise],
    ['Food', report.totals.food_paise],
    ['Fuel', report.totals.fuel_paise],
    ['Transport', report.totals.transport_paise],
    ['Other', report.totals.other_paise],
  ];
  const trips = report.trips.length ? report.trips.map((trip) => `<article class="report-trip">
    <div class="report-trip-heading">
      <div><p class="eyebrow">${esc(trip.destination_city)}, ${esc(trip.destination_state)}</p><div class="trip-card-heading"><h3>${esc(trip.name)}</h3>${statusBadge(trip)}</div>
        <p>${dateLabel(trip.start_date)} – ${dateLabel(trip.end_date)}</p></div>
      <strong class="report-trip-total">${money(trip.total_paise)}</strong>
    </div>
    ${tripBreakdown(trip)}
  </article>`).join('') : `<div class="empty">No trips started in ${report.year}. Choose another year or create a trip for this year.</div>`;
  const availableYears = [...new Set([new Date().getFullYear(), ...state.trips.map((trip) => Number(trip.start_date.slice(0, 4)))])]
    .sort((left, right) => right - left);
  shell(`<p class="eyebrow">Domestic travel · India</p><h1 class="heading">Annual travel report</h1>
    <p class="subheading">Review your trip spending by category and compare trips for a year.</p>
    ${domesticTabs()}
    <div class="report-year-row"><label class="field"><span>Report year</span><select data-field="report-year" aria-label="Report year">
      ${availableYears.map((year) => `<option value="${year}" ${year === report.year ? 'selected' : ''}>${year}</option>`).join('')}
    </select></label><span class="muted">${report.trips.length} trip${report.trips.length === 1 ? '' : 's'}</span></div>
    <section class="report-total"><span>Total trip spend in ${report.year}</span><strong>${money(report.totals.total_paise)}</strong></section>
    <div class="grid report-summary-grid">${categories.map(([label, amount]) => `<div class="summary"><span>${label}</span><strong>${money(amount)}</strong></div>`).join('')}</div>
    <div class="section-head"><div><h2>Trips in ${report.year}</h2><p>Trips are grouped by their departure year.</p></div></div>
    <section class="panel report-trip-list">${trips}</section>`, { title: 'Annual report' });
}

function calendarHtml(trip) {
  const start = new Date(`${trip.start_date}T00:00:00Z`);
  const monthDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + state.calendarOffset, 1));
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthDate);
  const firstWeekday = monthDate.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let days = '<div class="calendar-day weekday">S</div><div class="calendar-day weekday">M</div><div class="calendar-day weekday">T</div><div class="calendar-day weekday">W</div><div class="calendar-day weekday">T</div><div class="calendar-day weekday">F</div><div class="calendar-day weekday">S</div>';
  for (let i = 0; i < firstWeekday; i += 1) days += '<span></span>';
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const classes = ['calendar-day'];
    if (key >= trip.start_date && key <= trip.end_date) classes.push('travel');
    if (key === trip.start_date) classes.push('first');
    if (key === trip.end_date) classes.push('last');
    days += `<span class="${classes.join(' ')}" aria-label="${key}">${day}</span>`;
  }
  return `<div class="calendar-head"><button class="button secondary small" data-action="calendar-prev" aria-label="Previous month">‹</button><strong>${monthLabel}</strong><button class="button secondary small" data-action="calendar-next" aria-label="Next month">›</button></div><div class="calendar-grid">${days}</div>`;
}

function expenseForm(trip) {
  const existing = state.editingExpense ? trip.expenses.find((item) => item.id === state.editingExpense) : null;
  const amount = existing ? (existing.amount_paise / 100).toFixed(2) : '';
  const defaultExpenseDate = today() < trip.start_date || today() > trip.end_date ? trip.start_date : today();
  return `<form class="form-stack" data-form="expense" data-id="${existing?.id || ''}">
    <h3 class="form-title">${existing ? 'Update expense' : 'Add an expense'}</h3>
    <div class="field-row">
      <label class="field"><span>Date</span><input name="expenseDate" type="date" required min="${trip.start_date}" max="${trip.end_date}" value="${existing?.expense_date || defaultExpenseDate}"></label>
      <label class="field"><span>Category</span><select name="category" required>
        ${[['food', 'Food'], ['fuel', 'Fuel'], ['transport', 'Transport'], ['other', 'Other']].map(([value, label]) => `<option value="${value}" ${existing?.category === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Description</span><input name="description" required maxlength="160" value="${esc(existing?.description || '')}" placeholder="Lunch, toll, taxi..."></label>
      <label class="field"><span>Amount (INR)</span><input name="amount" type="number" required min="0.01" max="10000000" step="0.01" value="${amount}" placeholder="0.00"></label>
    </div>
    <label class="field"><span>Payment method <small class="muted">(optional)</small></span><input name="paymentMethod" maxlength="40" value="${esc(existing?.payment_method || '')}" placeholder="UPI, cash, card..."></label>
    <label class="field"><span>Notes <small class="muted">(optional)</small></span><textarea name="notes" maxlength="1000">${esc(existing?.notes || '')}</textarea></label>
    <div class="actions"><button class="button" type="submit">${existing ? 'Save changes' : 'Add expense'}</button>${existing ? '<button class="button secondary" type="button" data-action="cancel-expense">Cancel edit</button>' : ''}</div>
  </form>`;
}

function stayForm(stayData) {
  const { trip, stays } = stayData;
  const existing = state.editingStay ? stays.find((item) => item.id === state.editingStay) : null;
  const hotelAmount = existing?.hotel_amount_paise ? (existing.hotel_amount_paise / 100).toFixed(2) : '';
  return `<form class="form-stack" data-form="stay" data-id="${existing?.id || ''}">
    <h3 class="form-title">${existing ? 'Update hotel stay' : 'Add hotel stay'}</h3>
    <label class="field"><span>Hotel name</span><input name="hotelName" required maxlength="120" value="${esc(existing?.hotel_name || '')}" placeholder="Hotel or accommodation"></label>
    <label class="field"><span>Amount paid (INR) <small class="muted">(optional)</small></span><input name="hotelAmount" type="number" min="0" max="10000000" step="0.01" value="${hotelAmount}" placeholder="0.00"></label>
    <label class="field"><span>Address <small class="muted">(optional)</small></span><input name="address" maxlength="300" value="${esc(existing?.address || '')}" placeholder="Street, area, city"></label>
    <div class="field-row">
      <label class="field"><span>Check-in</span><input name="checkIn" type="date" required min="${trip.start_date}" max="${trip.end_date}" value="${existing?.check_in || trip.start_date}"></label>
      <label class="field"><span>Check-out</span><input name="checkOut" type="date" required min="${trip.start_date}" max="${trip.end_date}" value="${existing?.check_out || trip.end_date}"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Phone <small class="muted">(optional)</small></span><input name="phone" maxlength="40" value="${esc(existing?.phone || '')}"></label>
      <label class="field"><span>Booking reference <small class="muted">(optional)</small></span><input name="bookingReference" maxlength="80" value="${esc(existing?.booking_reference || '')}"></label>
    </div>
    <label class="field"><span>Notes <small class="muted">(optional)</small></span><textarea name="notes" maxlength="1000">${esc(existing?.notes || '')}</textarea></label>
    <div class="actions"><button class="button" type="submit">${existing ? 'Save hotel details' : 'Save hotel stay'}</button>${existing ? '<button class="button secondary" type="button" data-action="cancel-stay">Cancel edit</button>' : ''}</div>
  </form>`;
}

function renderTrip() {
  const { trip, stays: tripStays, expenses: tripExpenses } = state.trip;
  const tripTransports = state.trip.transports;
  const total = tripExpenses.reduce((sum, item) => sum + item.amount_paise, 0)
    + tripStays.reduce((sum, item) => sum + item.hotel_amount_paise, 0)
    + tripTransports.reduce((sum, item) => sum + item.amount_paise, 0);
  const stays = tripStays.length ? tripStays.map((stay) => `<article class="stay-card">
    <div><h3>${esc(stay.hotel_name)}</h3><p>${dateLabel(stay.check_in)} – ${dateLabel(stay.check_out)}</p>
      ${stay.hotel_amount_paise > 0 ? `<p>Amount paid: ${money(stay.hotel_amount_paise)}</p>` : ''}
      ${stay.address ? `<p>${esc(stay.address)}</p>` : ''}${stay.phone ? `<p>${esc(stay.phone)}</p>` : ''}
      ${stay.booking_reference ? `<p>Booking ref: ${esc(stay.booking_reference)}</p>` : ''}${stay.notes ? `<p>${esc(stay.notes)}</p>` : ''}
    </div><div class="actions"><button class="button secondary small" data-action="edit-stay" data-id="${stay.id}">Edit</button><button class="button danger small" data-action="delete-stay" data-id="${stay.id}">Delete</button></div>
  </article>`).join('') : '<div class="empty">No hotel stays yet. Save hotel details here for quick access while travelling.</div>';
  const expenses = tripExpenses.length ? tripExpenses.map((expense) => `<article class="expense-row">
    <div><span class="category">${esc(expense.category)}</span><h3 class="expense-description">${esc(expense.description)}</h3>
      <p>${dateLabel(expense.expense_date)}${expense.payment_method ? ` · ${esc(expense.payment_method)}` : ''}</p>${expense.notes ? `<p>${esc(expense.notes)}</p>` : ''}
    </div><div class="expense-amount">${money(expense.amount_paise)}
      <div class="actions actions-end spaced-top-small"><button class="button secondary small" data-action="edit-expense" data-id="${expense.id}">Edit</button><button class="button danger small" data-action="delete-expense" data-id="${expense.id}">Delete</button></div>
    </div>
  </article>`).join('') : '<div class="empty">No expenses added yet. Record food, fuel, transport, and other trip costs as they happen.</div>';
  const transports = tripTransports.length ? tripTransports.map((transport) => `<article class="expense-row">
    <div><span class="category">${esc(transport.mode.replace('-', ' '))}</span>
      <h3 class="expense-description">${esc(transport.details.operator || transport.details.serviceNumber || transport.details.vehicleNumber || transport.mode)}</h3>
      ${transport.mode === 'car' ? '' : `<p>${dateLabel(transport.transport_date)}${transportDetails(transport) ? ` · ${transportDetails(transport)}` : ''}</p>`}
    </div><div class="expense-amount">${money(transport.amount_paise)}
      <div class="actions actions-end spaced-top-small"><button class="button secondary small" data-action="edit-transport" data-id="${transport.id}">Edit</button><button class="button danger small" data-action="delete-transport" data-id="${transport.id}">Delete</button></div>
    </div>
  </article>`).join('') : '<div class="empty">No transport records yet. Add flight, train, road, or other transport details and costs.</div>';
  shell(`<p class="eyebrow">Domestic trip · ${esc(trip.destination_city)}, ${esc(trip.destination_state)} · ${tripStatus(trip).label}</p>
    <h1 class="heading">${esc(trip.name)}</h1><p class="subheading">${dateLabel(trip.start_date)} – ${dateLabel(trip.end_date)} · ${esc(trip.transport_mode.replace('-', ' '))}</p>
    <div class="grid summary-grid"><div class="summary"><span>Total trip expenses</span><strong>${money(total)}</strong></div><div class="summary"><span>Expense entries</span><strong>${tripExpenses.length + tripTransports.length}</strong></div><div class="summary"><span>Hotel stays</span><strong>${tripStays.length}</strong></div></div>
    <details class="panel"><summary class="form-title">Edit travel plan</summary><form class="form-stack spaced-top-small" data-form="edit-trip">
      <div class="field-row"><label class="field"><span>Trip name</span><input name="name" required maxlength="100" value="${esc(trip.name)}"></label><label class="field"><span>Destination city</span><input name="destinationCity" required maxlength="100" value="${esc(trip.destination_city)}"></label></div>
      <div class="field-row"><label class="field"><span>State / union territory</span><select name="destinationState" required>
        ${!indianStatesAndTerritories.includes(trip.destination_state) ? `<option value="${esc(trip.destination_state)}" selected>${esc(trip.destination_state)}</option>` : ''}
        ${indianStatesAndTerritories.map((name) => `<option value="${esc(name)}" ${trip.destination_state === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Mode of transport</span><select name="transportMode">${[['car','Car'],['train','Train'],['bus','Bus'],['flight','Flight'],['taxi','Taxi'],['two-wheeler','Two-wheeler'],['other','Other']].map(([v,l])=>`<option value="${v}" ${trip.transport_mode===v?'selected':''}>${l}</option>`).join('')}</select></label></div>
      <div class="field-row"><label class="field"><span>Departure date</span><input name="startDate" type="date" required value="${trip.start_date}"></label><label class="field"><span>Return date</span><input name="endDate" type="date" required value="${trip.end_date}"></label></div>
      <label class="field"><span>Trip notes</span><textarea name="notes" maxlength="2000">${esc(trip.notes)}</textarea></label>
      <button class="button" type="submit">Save travel plan</button></form></details>
    <section class="panel spaced-top-small"><div class="section-head section-topless"><div><h2>Travel dates</h2><p>Trip days are highlighted on the calendar.</p></div></div>${calendarHtml(trip)}</section>
    <details class="panel collapsible-panel spaced-top-small" data-section="hotels" ${state.openSections.hotels ? 'open' : ''}>
      <summary class="collapsible-summary"><span><strong>Hotel stays</strong><small>Keep check-in dates, address, and booking details handy.</small></span></summary>
      <div class="collapsible-content">
        <div class="saved-records">${stays}</div>
        <details class="form-disclosure spaced-top-small" ${state.editingStay ? 'open' : ''}>
          <summary>${state.editingStay ? 'Edit hotel stay' : 'Add hotel stay'}</summary>
          ${stayForm(state.trip)}
        </details>
      </div>
    </details>
    <details class="panel collapsible-panel spaced-top-small" data-section="transports" ${state.openSections.transports ? 'open' : ''}>
      <summary class="collapsible-summary"><span><strong>Transport</strong><small>Track tickets, routes, vehicle details, and transport costs.</small></span></summary>
      <div class="collapsible-content">
        <div class="saved-records">${transports}</div>
        <details class="form-disclosure spaced-top-small" ${state.editingTransport ? 'open' : ''}>
          <summary>${state.editingTransport ? 'Edit transport' : 'Add transport'}</summary>
          ${transportForm(state.trip)}
        </details>
      </div>
    </details>
    <details class="panel collapsible-panel spaced-top-small" data-section="expenses" ${state.openSections.expenses ? 'open' : ''}>
      <summary class="collapsible-summary"><span><strong>Expenses</strong><small>Log each expense in INR. Entries can be corrected later.</small></span></summary>
      <div class="collapsible-content">
        <div class="saved-records">${expenses}</div>
        <details class="form-disclosure spaced-top-small" ${state.editingExpense ? 'open' : ''}>
          <summary>${state.editingExpense ? 'Edit expense' : 'Add expense'}</summary>
          ${expenseForm(trip)}
        </details>
      </div>
    </details>
    <div class="actions spaced-top"><button class="button danger" data-action="delete-trip">Delete this trip</button></div>`, { title: 'Trip details', back: true });
}

async function loadTrips() {
  const result = await api('/api/trips');
  state.trips = result.trips;
}
async function loadAnnualReport(year = state.reportYear) {
  state.annualReport = await api(`/api/reports/annual?year=${encodeURIComponent(year)}`);
}
async function loadTrip(id = state.trip?.trip.id, resetSections = false) {
  const result = await api(`/api/trips/${id}`);
  state.trip = result;
  state.editingExpense = null;
  state.editingStay = null;
  state.editingTransport = null;
  if (resetSections) state.openSections = { hotels: false, transports: false, expenses: false };
}
async function render() {
  if (!state.user) return renderAuth();
  if (!state.section) return renderTravelType();
  if (state.section === 'international') return renderInternational();
  if (state.trip) return renderTrip();
  await loadTrips();
  if (state.domesticView === 'report') {
    await loadAnnualReport();
    return renderAnnualReport();
  }
  renderTrips();
}
async function start() {
  try {
    const result = await api('/api/me');
    state.user = result.user;
  } catch (error) {
    if (error.status !== 401) {
      shell(`<div class="empty">${esc(error.message)}</div>`);
      return;
    }
    state.user = null;
  }
  try { await render(); } catch (error) { shell(`<div class="empty">${esc(error.message)}</div>`); }
}

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'auth-login' || action === 'auth-register') { state.authMode = action === 'auth-login' ? 'login' : 'register'; renderAuth(); }
    if (action === 'domestic') { state.section = 'domestic'; state.domesticView = 'trips'; await render(); }
    if (action === 'show-trips') { state.domesticView = 'trips'; await render(); }
    if (action === 'show-report') { state.domesticView = 'report'; await render(); }
    if (action === 'international') { state.section = 'international'; renderInternational(); }
    if (action === 'new-trip') { state.showTripForm = !state.showTripForm; await render(); }
    if (action === 'cancel-trip') { state.showTripForm = false; await render(); }
    if (action === 'change-type') { state.section = null; await render(); }
    if (action === 'open-trip') { await loadTrip(Number(button.dataset.id), true); renderTrip(); }
    if (action === 'back') { state.trip = null; await render(); }
    if (action === 'logout') { await api('/api/auth/logout', { method: 'POST' }); state.user = null; state.trip = null; state.section = null; renderAuth(); }
    if (action === 'calendar-prev') { state.calendarOffset -= 1; renderTrip(); }
    if (action === 'calendar-next') { state.calendarOffset += 1; renderTrip(); }
    if (action === 'edit-expense') { state.editingExpense = Number(button.dataset.id); state.openSections.expenses = true; renderTrip(); document.querySelector('[data-form=expense]').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (action === 'cancel-expense') { state.editingExpense = null; renderTrip(); }
    if (action === 'delete-expense') {
      if (!confirm('Delete this expense entry?')) return;
      await api(`/api/trips/${state.trip.trip.id}/expenses/${button.dataset.id}`, { method: 'DELETE' });
      await loadTrip(); renderTrip(); notify('Expense deleted.');
    }
    if (action === 'edit-stay') { state.editingStay = Number(button.dataset.id); state.openSections.hotels = true; renderTrip(); document.querySelector('[data-form=stay]').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (action === 'cancel-stay') { state.editingStay = null; renderTrip(); }
    if (action === 'delete-stay') {
      if (!confirm('Delete these hotel details?')) return;
      await api(`/api/trips/${state.trip.trip.id}/stays/${button.dataset.id}`, { method: 'DELETE' });
      await loadTrip(); renderTrip(); notify('Hotel stay deleted.');
    }
    if (action === 'edit-transport') { state.editingTransport = Number(button.dataset.id); state.openSections.transports = true; renderTrip(); document.querySelector('[data-form=transport]').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (action === 'cancel-transport') { state.editingTransport = null; renderTrip(); }
    if (action === 'delete-transport') {
      if (!confirm('Delete this transport record?')) return;
      await api(`/api/trips/${state.trip.trip.id}/transports/${button.dataset.id}`, { method: 'DELETE' });
      await loadTrip(); renderTrip(); notify('Transport record deleted.');
    }
    if (action === 'delete-trip') {
      if (!confirm('Delete this trip, hotel information, and all its expense entries? This cannot be undone.')) return;
      await api(`/api/trips/${state.trip.trip.id}`, { method: 'DELETE' });
      state.trip = null; await render(); notify('Trip deleted.');
    }
  } catch (error) { notify(error.message); }
});

app.addEventListener('change', async (event) => {
  if (event.target.matches('[data-field="transport-mode"]')) {
    const form = event.target.form;
    const date = form.querySelector('[name="transportDate"]')?.value || state.trip.trip.start_date;
    const amount = form.querySelector('[name="amount"]').value;
    form.querySelector('.transport-common-fields').outerHTML = transportCommonFields(state.trip.trip, event.target.value, date, amount);
    form.querySelector('.transport-detail-fields').innerHTML = transportFieldsMarkup(event.target.value);
  }
  if (event.target.matches('[data-field="report-year"]')) {
    state.reportYear = Number(event.target.value);
    try {
      await loadAnnualReport();
      renderAnnualReport();
    } catch (error) {
      notify(error.message);
    }
  }
});

app.addEventListener('toggle', (event) => {
  const section = event.target.closest('details[data-section]');
  if (section) state.openSections[section.dataset.section] = section.open;
}, true);

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = form.querySelector('[type=submit]');
  if (submit) submit.disabled = true;
  try {
    if (form.dataset.form === 'auth') {
      const isRegister = state.authMode === 'register';
      const result = await api(`/api/auth/${isRegister ? 'register' : 'login'}`, { method: 'POST', body: values });
      state.user = result.user; state.section = null; state.trip = null;
      await render();
    }
    if (form.dataset.form === 'trip') {
      await api('/api/trips', { method: 'POST', body: { ...values, travelType: 'domestic' } });
      state.showTripForm = false; await render(); notify('Trip created.');
    }
    if (form.dataset.form === 'edit-trip') {
      await api(`/api/trips/${state.trip.trip.id}`, { method: 'PUT', body: values });
      await loadTrip(); renderTrip(); notify('Travel plan updated.');
    }
    if (form.dataset.form === 'stay') {
      const id = form.dataset.id;
      await api(`/api/trips/${state.trip.trip.id}/stays${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: { ...values, hotelAmount: values.hotelAmount === '' ? 0 : Number(values.hotelAmount) },
      });
      await loadTrip(); renderTrip(); notify(id ? 'Hotel details updated.' : 'Hotel stay saved.');
    }
    if (form.dataset.form === 'expense') {
      const id = form.dataset.id;
      await api(`/api/trips/${state.trip.trip.id}/expenses${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: { ...values, amount: Number(values.amount) } });
      await loadTrip(); renderTrip(); notify(id ? 'Expense updated.' : 'Expense added.');
    }
    if (form.dataset.form === 'transport') {
      const id = form.dataset.id;
      const details = Object.fromEntries([...form.querySelectorAll('.transport-detail-fields [name^="detail-"]')]
        .map((field) => [field.name.slice('detail-'.length), field.value]));
      await api(`/api/trips/${state.trip.trip.id}/transports${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: { transportDate: values.transportDate, mode: values.mode, amount: Number(values.amount), details },
      });
      await loadTrip(); renderTrip(); notify(id ? 'Transport updated.' : 'Transport added.');
    }
  } catch (error) {
    notify(error.message);
    if (submit) submit.disabled = false;
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}), { once: true });
}
start();
