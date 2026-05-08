const state = {
  barbers: [],
  services: [],
  timeSlots: [],
  selectedServiceId: null
};

const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const money = (value) => `R$ ${Number(value || 0).toFixed(2)}`;

const serviceImage = (serviceName = '') => {
  const normalized = serviceName.toLowerCase();
  if (normalized.includes('cabelo') && normalized.includes('barba')) return 'assets/service-combo.svg';
  if (normalized.includes('barba')) return 'assets/service-barba.svg';
  if (normalized.includes('cabelo')) return 'assets/service-cabelo.svg';
  return 'assets/barbershop-bg.svg';
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação');
  return data;
};

const selectedService = () => state.services.find((item) => item.id === Number(state.selectedServiceId));

const fillBarbers = () => {
  const barberSelect = $('[name="barberId"]');

  barberSelect.innerHTML = `
    <option value="">Escolha o barbeiro</option>
    ${state.barbers.map((barber) => `
      <option value="${barber.id}">
        ${escapeHtml(barber.name)}${barber.specialty ? ` - ${escapeHtml(barber.specialty)}` : ''}
      </option>
    `).join('')}
  `;
};

const renderServicePreview = () => {
  const container = $('#service-preview');
  if (!container) return;

  container.innerHTML = state.services.length
    ? state.services.map((service) => `
      <button class="service-card service-option" type="button" data-service-id="${service.id}">
        <img src="${serviceImage(service.name)}" alt="" loading="lazy" />
        <span>${escapeHtml(service.duration)} min</span>
        <h3>${escapeHtml(service.name)}</h3>
        <p>${money(service.price)}</p>
        <strong>Agendar este serviço</strong>
      </button>
    `).join('')
    : '<p class="auth-note">Cadastre serviços para exibir opções de agendamento.</p>';

  document.querySelectorAll('.service-option').forEach((button) => {
    button.addEventListener('click', () => openBookingModal(button.dataset.serviceId));
  });
};

const updateSummary = () => {
  const service = selectedService();
  const barberId = Number($('[name="barberId"]').value);
  const barber = state.barbers.find((item) => item.id === barberId);
  const date = $('[name="date"]').value;
  const time = $('[name="time"]').value;

  $('#booking-summary').innerHTML = `
    <p>Serviço: <strong>${service ? escapeHtml(service.name) : 'Não selecionado'}</strong></p>
    <p>Preço: <strong>${service ? money(service.price) : '-'}</strong></p>
    <p>Duração: <strong>${service ? `${service.duration} min` : '-'}</strong></p>
    <p>Barbeiro: <strong>${barber ? escapeHtml(barber.name) : 'Não selecionado'}</strong></p>
    <p>Data e horário: <strong>${date && time ? `${date} às ${time}` : '-'}</strong></p>
  `;
};

const loadAvailability = async () => {
  const barberId = $('[name="barberId"]').value;
  const serviceId = $('[name="serviceId"]').value;
  const date = $('[name="date"]').value;
  const timeSelect = $('[name="time"]');

  timeSelect.disabled = true;
  timeSelect.innerHTML = '<option value="">Escolha data e barbeiro</option>';

  if (!barberId || !serviceId || !date) {
    updateSummary();
    return;
  }

  try {
    const data = await fetchJson(`/api/public/availability?barberId=${encodeURIComponent(barberId)}&serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`);
    timeSelect.innerHTML = data.availableTimes.length
      ? `<option value="">Escolha o horário</option>${data.availableTimes.map((time) => `<option value="${time}">${time}</option>`).join('')}`
      : '<option value="">Sem horários disponíveis</option>';
    timeSelect.disabled = data.availableTimes.length === 0;
  } catch (err) {
    timeSelect.innerHTML = '<option value="">Erro ao carregar horários</option>';
    $('#booking-message').textContent = err.message;
  }

  updateSummary();
};

const openBookingModal = (serviceId) => {
  const service = state.services.find((item) => item.id === Number(serviceId));
  if (!service) return;

  state.selectedServiceId = service.id;
  $('#booking-form').reset();
  $('[name="serviceId"]').value = service.id;
  $('[name="time"]').disabled = true;
  $('[name="time"]').innerHTML = '<option value="">Escolha data e barbeiro</option>';
  $('#booking-message').textContent = '';
  updateSummary();

  $('#booking-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('[name="name"]').focus();
};

const closeBookingModal = () => {
  $('#booking-modal').hidden = true;
  document.body.classList.remove('modal-open');
};

const submitBooking = async (event) => {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const message = $('#booking-message');

  message.textContent = 'Enviando agendamento...';

  const body = {
    name: formData.get('name'),
    phone: formData.get('phone'),
    email: '',
    serviceId: formData.get('serviceId'),
    barberId: formData.get('barberId'),
    date: formData.get('date'),
    time: formData.get('time'),
    notes: 'Agendamento feito pelo cliente'
  };

  try {
    const result = await fetchJson('/api/public/appointments', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    message.textContent = `Agendamento confirmado para ${result.date} às ${result.time}.`;
    form.reset();
    state.selectedServiceId = null;
    $('[name="time"]').disabled = true;
    $('[name="time"]').innerHTML = '<option value="">Escolha data e barbeiro</option>';
    updateSummary();
  } catch (err) {
    message.textContent = err.message;
    await loadAvailability();
  }
};

const init = async () => {
  const today = new Date().toISOString().slice(0, 10);
  $('[name="date"]').min = today;

  const data = await fetchJson('/api/public/data');
  state.barbers = data.barbers;
  state.services = data.services;
  state.timeSlots = data.timeSlots;

  fillBarbers();
  renderServicePreview();
  updateSummary();

  $('[name="barberId"]').addEventListener('change', loadAvailability);
  $('[name="date"]').addEventListener('change', loadAvailability);
  $('[name="time"]').addEventListener('change', updateSummary);
  $('#booking-form').addEventListener('submit', submitBooking);
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeBookingModal);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#booking-modal').hidden) closeBookingModal();
  });
};

init().catch((err) => {
  const container = $('#service-preview') || document.body;
  container.innerHTML = `<p class="auth-note">${escapeHtml(err.message)}</p>`;
});
