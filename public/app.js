const state = {
  view: 'login',
  token: localStorage.getItem('barbeariaToken') || '',
  loggedIn: false,
  user: null,
  clients: [],
  barbers: [],
  services: [],
  appointments: [],
  users: [],
  editClient: null,
  editBarber: null,
  editService: null,
  editAppointment: null,
  editUser: null,
  report: null,
  reportRange: { start: '', end: '' }
};

const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeAttr = escapeHtml;
const money = (value) => `R$ ${Number(value || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const formatDate = (value) => {
  if (!value) return '-';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
};
const phoneDigits = (value = '') => String(value).replace(/\D/g, '');
const whatsappLink = (phone) => {
  const digits = phoneDigits(phone);
  return digits ? `https://wa.me/55${digits}` : '';
};
const formatStatus = (status) => ({
  Agendado: 'Agendado',
  Concluido: 'Concluido',
  Cancelado: 'Cancelado'
}[status] || status);

const headers = {
  dashboard: 'Dashboard',
  clients: 'Clientes',
  barbers: 'Barbeiros',
  services: 'Serviços',
  appointments: 'Agendamentos',
  reports: 'Relatórios',
  users: 'Usuários'
};

const viewIcons = {
  login: '🔐',
  dashboard: '🏠',
  clients: '👥',
  barbers: '✂️',
  services: '🪒',
  appointments: '📅',
  reports: '📊',
  users: '👤'
};

const authHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return headers;
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: authHeaders(),
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      logout();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    throw new Error(data.error || 'Erro de comunicação');
  }
  return data;
};

const setToken = (token) => {
  state.token = token;
  if (token) {
    localStorage.setItem('barbeariaToken', token);
  } else {
    localStorage.removeItem('barbeariaToken');
  }
};

const setNavVisibility = () => {
  document.querySelectorAll('nav button').forEach((button) => {
    if (button.dataset.view === 'users') {
      button.style.display = state.user && state.user.role === 'admin' ? 'inline-flex' : 'none';
      if (button.classList.contains('active') && button.style.display === 'none') {
        document.querySelector('nav button[data-view="clients"]').click();
      }
    }
  });
};

const logout = () => {
  setToken('');
  state.loggedIn = false;
  state.user = null;
  state.view = 'login';
  document.querySelector('header nav').style.display = 'none';
  $('#logout').hidden = true;
  render();
};

const loadProfile = async () => {
  if (!state.token) return;
  try {
    const profile = await fetchJson('/api/profile');
    state.user = profile;
    state.loggedIn = true;
    document.querySelector('header nav').style.display = 'flex';
    $('#logout').hidden = false;
    setNavVisibility();
  } catch (err) {
    state.loggedIn = false;
    state.user = null;
  }
};

const loadAll = async () => {
  state.clients = await fetchJson('/api/clients');
  state.barbers = await fetchJson('/api/barbers');
  state.services = await fetchJson('/api/services');
  state.appointments = await fetchJson('/api/appointments');
};

const loadReport = async () => {
  const query = [];
  if (state.reportRange.start) query.push(`start=${state.reportRange.start}`);
  if (state.reportRange.end) query.push(`end=${state.reportRange.end}`);
  const path = `/api/reports/summary${query.length ? `?${query.join('&')}` : ''}`;
  state.report = await fetchJson(path);
};

const loadUsers = async () => {
  try {
    state.users = await fetchJson('/api/users');
  } catch (err) {
    console.error('Erro ao carregar usuários:', err);
    state.users = [];
  }
};

const render = () => {
  const title = state.loggedIn ? headers[state.view] : 'Login';
  const icon = viewIcons[state.loggedIn ? state.view : 'login'];

  $('#page-title').innerHTML = `
    <span class="view-icon">${icon}</span>
    <h2>${title}</h2>
  `;
  const content = $('#content');
  if (!state.loggedIn) return renderLogin(content);
  if (state.view === 'dashboard') return renderDashboardV2(content);
  if (state.view === 'clients') return renderClients(content);
  if (state.view === 'barbers') return renderBarbers(content);
  if (state.view === 'services') return renderServices(content);
  if (state.view === 'appointments') return renderAppointments(content);
  if (state.view === 'reports') return renderReports(content);
  if (state.view === 'users') return renderUsers(content);
};

const renderDashboardV2 = (container) => {
  const today = todayIso();
  const todayAppointments = state.appointments
    .filter((item) => item.date === today)
    .sort((a, b) => a.time.localeCompare(b.time));
  const nextAppointments = state.appointments
    .filter((item) => item.status === 'Agendado' && item.date >= today)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .slice(0, 5);
  const completed = state.appointments.filter((item) => item.status === 'Concluido').length;
  const scheduled = state.appointments.filter((item) => item.status === 'Agendado').length;
  const canceled = state.appointments.filter((item) => item.status === 'Cancelado').length;
  const revenue = state.appointments
    .filter((item) => item.status === 'Concluido')
    .reduce((total, item) => total + Number(item.servicePrice || 0), 0);
  const todayRevenue = todayAppointments
    .filter((item) => item.status === 'Concluido')
    .reduce((total, item) => total + Number(item.servicePrice || 0), 0);

  container.innerHTML = `
    <div class="dashboard-grid">
      <div class="metric-card"><h4>Hoje</h4><p>${todayAppointments.length}</p><span>agendamentos</span></div>
      <div class="metric-card"><h4>Agendados</h4><p>${scheduled}</p><span>em aberto</span></div>
      <div class="metric-card"><h4>Faturamento hoje</h4><p>${money(todayRevenue)}</p><span>concluidos</span></div>
      <div class="metric-card"><h4>Faturamento total</h4><p>${money(revenue)}</p><span>concluidos</span></div>
    </div>
    <div class="dashboard-panels">
      <section class="card">
        <div class="card-heading"><h3>Agenda de hoje</h3><span>${formatDate(today)}</span></div>
        ${todayAppointments.length ? `
          <div class="appointment-list">
            ${todayAppointments.map((item) => `
              <article class="appointment-item">
                <strong>${escapeHtml(item.time)} - ${escapeHtml(item.clientName)}</strong>
                <span>${escapeHtml(item.serviceName)} com ${escapeHtml(item.barberName)}</span>
                <em class="status ${safeAttr(item.status)}">${escapeHtml(formatStatus(item.status))}</em>
              </article>
            `).join('')}
          </div>
        ` : '<p class="empty-state">Nenhum agendamento para hoje.</p>'}
      </section>
      <section class="card">
        <div class="card-heading"><h3>Proximos horarios</h3><span>${nextAppointments.length} pendentes</span></div>
        ${nextAppointments.length ? `
          <div class="appointment-list">
            ${nextAppointments.map((item) => `
              <article class="appointment-item">
                <strong>${formatDate(item.date)} - ${escapeHtml(item.time)}</strong>
                <span>${escapeHtml(item.clientName)} - ${escapeHtml(item.serviceName)}</span>
                <em>${escapeHtml(item.barberName)}</em>
              </article>
            `).join('')}
          </div>
        ` : '<p class="empty-state">Nenhum proximo horario agendado.</p>'}
      </section>
    </div>
    <div class="card status-overview">
      <div class="status-row">
        <span class="status-pill">Clientes: ${state.clients.length}</span>
        <span class="status-pill">Barbeiros: ${state.barbers.length}</span>
        <span class="status-pill">Servicos: ${state.services.length}</span>
        <span class="status-pill">Concluidos: ${completed}</span>
        <span class="status-pill">Cancelados: ${canceled}</span>
      </div>
    </div>
  `;
};

const renderDashboard = (container) => {
  const completed = state.appointments.filter((item) => item.status === 'Concluido').length;
  const scheduled = state.appointments.filter((item) => item.status === 'Agendado').length;
  const canceled = state.appointments.filter((item) => item.status === 'Cancelado').length;
  const revenue = state.appointments
    .filter((item) => item.status === 'Concluido')
    .reduce((total, item) => total + Number(item.servicePrice || 0), 0);

  container.innerHTML = `
    <div class="dashboard-grid">
      <div class="metric-card">
        <h4>Clientes</h4>
        <p>${state.clients.length}</p>
      </div>
      <div class="metric-card">
        <h4>Barbeiros</h4>
        <p>${state.barbers.length}</p>
      </div>
      <div class="metric-card">
        <h4>Serviços</h4>
        <p>${state.services.length}</p>
      </div>
      <div class="metric-card">
        <h4>Agendamentos</h4>
        <p>${state.appointments.length}</p>
      </div>
    </div>
    <div class="card">
      <div class="status-row">
        <span class="status-pill">Agendados: ${scheduled}</span>
        <span class="status-pill">Concluídos: ${completed}</span>
        <span class="status-pill">Cancelados: ${canceled}</span>
      </div>
      <div class="metric-card" style="margin-top: 20px;">
        <h4>Faturamento total</h4>
        <p>${money(revenue)}</p>
      </div>
    </div>
  `;
};

const renderLogin = (container) => {
  document.querySelector('header nav').style.display = 'none';
  $('#logout').hidden = true;
  container.innerHTML = `
    <div class="login-shell">
      <div class="login-copy">
        <span class="login-mark">✂</span>
        <p class="eyebrow">Acesso restrito</p>
        <h3>Painel administrativo</h3>
        <p>Controle agenda, equipe, serviços e faturamento em uma área privada.</p>
        <div class="login-highlights">
          <span>Agenda</span>
          <span>Clientes</span>
          <span>Relatórios</span>
        </div>
      </div>
      <div class="card login-card">
        <p class="eyebrow">Entrar</p>
        <h3>Bem-vindo de volta</h3>
        <form id="login-form">
          <label>
            <span>Usuário</span>
            <input name="username" placeholder="Digite seu usuário" autocomplete="username" required />
          </label>
          <label>
            <span>Senha</span>
            <input name="password" type="password" placeholder="Digite sua senha" autocomplete="current-password" required />
          </label>
          <button class="primary">Entrar no painel</button>
        </form>
        <a class="link-button" href="/booking.html">Ver página de agendamento</a>
      </div>
    </div>
  `;

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const username = formData.get('username');
    const password = formData.get('password');

    try {
      const data = await fetchJson('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      setToken(data.token);
      state.loggedIn = true;
      state.view = 'dashboard';
      document.querySelector('header nav').style.display = 'flex';
      $('#logout').hidden = false;
      await loadProfile();
      await refresh();
    } catch (error) {
      alert(error.message);
    }
  });
};

const renderClients = (container) => {
  const edit = state.editClient || { name: '', phone: '', email: '', notes: '' };
  const buttonLabel = state.editClient ? 'Atualizar cliente' : 'Salvar cliente';

  container.innerHTML = `
    <div class="card">
      <h3>${state.editClient ? 'Editar cliente' : 'Novo cliente'}</h3>
      <form id="client-form">
        <input name="name" placeholder="Nome" required value="${safeAttr(edit.name)}" />
        <input name="phone" placeholder="Telefone" value="${safeAttr(edit.phone)}" />
        <input name="email" type="email" placeholder="Email" value="${safeAttr(edit.email)}" />
        <textarea name="notes" placeholder="Observacoes">${escapeHtml(edit.notes)}</textarea>
        <div>
          <button class="primary">${buttonLabel}</button>
          ${state.editClient ? '<button type="button" id="cancel-client" class="small-button">Cancelar</button>' : ''}
        </div>
      </form>
    </div>
    <div class="card table-wrapper">
      <h3>Lista de clientes</h3>
      <table>
        <thead><tr><th>Nome</th><th>Telefone</th><th>Email</th><th>Notas</th><th>Ações</th></tr></thead>
        <tbody>${state.clients.map(c => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.phone || '-')}</td><td>${escapeHtml(c.email || '-')}</td><td>${escapeHtml(c.notes || '-')}</td><td><button type="button" class="small-button edit-client" data-id="${c.id}">Editar</button><button type="button" class="small-button delete-client" data-id="${c.id}">Excluir</button></td></tr>`).join('')}</tbody>
      </table>
    </div>
  `;

  $('#client-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const body = {
      name: formData.get('name'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      notes: formData.get('notes')
    };

    if (state.editClient) {
      await fetchJson(`/api/clients/${state.editClient.id}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      state.editClient = null;
    } else {
      await fetchJson('/api/clients', { method: 'POST', body: JSON.stringify(body) });
    }

    await refresh();
  });

  document.querySelectorAll('.edit-client').forEach((button) => {
    button.addEventListener('click', () => {
      const client = state.clients.find((item) => item.id === Number(button.dataset.id));
      state.editClient = client;
      render();
    });
  });

  document.querySelectorAll('.delete-client').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetchJson(`/api/clients/${button.dataset.id}`, { method: 'DELETE' });
      await refresh();
    });
  });

  const cancelButton = $('#cancel-client');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      state.editClient = null;
      render();
    });
  }
};

const renderBarbers = (container) => {
  const edit = state.editBarber || { name: '', specialty: '', phone: '' };
  const buttonLabel = state.editBarber ? 'Atualizar barbeiro' : 'Salvar barbeiro';

  container.innerHTML = `
    <div class="card">
      <h3>${state.editBarber ? 'Editar barbeiro' : 'Novo barbeiro'}</h3>
      <form id="barber-form">
        <input name="name" placeholder="Nome" required value="${safeAttr(edit.name)}" />
        <input name="specialty" placeholder="Especialidade" value="${safeAttr(edit.specialty)}" />
        <input name="phone" placeholder="Telefone" value="${safeAttr(edit.phone)}" />
        <div>
          <button class="primary">${buttonLabel}</button>
          ${state.editBarber ? '<button type="button" id="cancel-barber" class="small-button">Cancelar</button>' : ''}
        </div>
      </form>
    </div>
    <div class="card table-wrapper">
      <h3>Lista de barbeiros</h3>
      <table>
        <thead><tr><th>Nome</th><th>Especialidade</th><th>Telefone</th><th>Ações</th></tr></thead>
        <tbody>${state.barbers.map(b => `<tr><td>${escapeHtml(b.name)}</td><td>${escapeHtml(b.specialty || '-')}</td><td>${escapeHtml(b.phone || '-')}</td><td><button type="button" class="small-button edit-barber" data-id="${b.id}">Editar</button><button type="button" class="small-button delete-barber" data-id="${b.id}">Excluir</button></td></tr>`).join('')}</tbody>
      </table>
    </div>
  `;

  $('#barber-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const body = {
      name: formData.get('name'),
      specialty: formData.get('specialty'),
      phone: formData.get('phone')
    };

    if (state.editBarber) {
      await fetchJson(`/api/barbers/${state.editBarber.id}`, { method: 'PUT', body: JSON.stringify(body) });
      state.editBarber = null;
    } else {
      await fetchJson('/api/barbers', { method: 'POST', body: JSON.stringify(body) });
    }

    await refresh();
  });

  document.querySelectorAll('.edit-barber').forEach((button) => {
    button.addEventListener('click', () => {
      const barber = state.barbers.find((item) => item.id === Number(button.dataset.id));
      state.editBarber = barber;
      render();
    });
  });

  document.querySelectorAll('.delete-barber').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetchJson(`/api/barbers/${button.dataset.id}`, { method: 'DELETE' });
      await refresh();
    });
  });

  const cancelButton = $('#cancel-barber');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      state.editBarber = null;
      render();
    });
  }
};

const renderServices = (container) => {
  const edit = state.editService || { name: '', duration: '', price: '' };
  const buttonLabel = state.editService ? 'Atualizar serviço' : 'Salvar serviço';

  container.innerHTML = `
    <div class="card">
      <h3>${state.editService ? 'Editar serviço' : 'Novo serviço'}</h3>
      <form id="service-form">
        <input name="name" placeholder="Nome do serviço" required value="${safeAttr(edit.name)}" />
        <input name="duration" type="number" min="1" placeholder="Duração (minutos)" required value="${safeAttr(edit.duration)}" />
        <input name="price" type="number" step="0.01" min="0.01" placeholder="Preço" required value="${safeAttr(edit.price)}" />
        <div>
          <button class="primary">${buttonLabel}</button>
          ${state.editService ? '<button type="button" id="cancel-service" class="small-button">Cancelar</button>' : ''}
        </div>
      </form>
    </div>
    <div class="card table-wrapper">
      <h3>Lista de serviços</h3>
      <table>
        <thead><tr><th>Nome</th><th>Duração</th><th>Preço</th><th>Ações</th></tr></thead>
        <tbody>${state.services.map(s => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.duration)} min</td><td>${money(s.price)}</td><td><button type="button" class="small-button edit-service" data-id="${s.id}">Editar</button><button type="button" class="small-button delete-service" data-id="${s.id}">Excluir</button></td></tr>`).join('')}</tbody>
      </table>
    </div>
  `;

  $('#service-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const body = {
      name: formData.get('name'),
      duration: formData.get('duration'),
      price: formData.get('price')
    };

    if (state.editService) {
      await fetchJson(`/api/services/${state.editService.id}`, { method: 'PUT', body: JSON.stringify(body) });
      state.editService = null;
    } else {
      await fetchJson('/api/services', { method: 'POST', body: JSON.stringify(body) });
    }

    await refresh();
  });

  document.querySelectorAll('.edit-service').forEach((button) => {
    button.addEventListener('click', () => {
      const service = state.services.find((item) => item.id === Number(button.dataset.id));
      state.editService = service;
      render();
    });
  });

  document.querySelectorAll('.delete-service').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetchJson(`/api/services/${button.dataset.id}`, { method: 'DELETE' });
      await refresh();
    });
  });

  const cancelButton = $('#cancel-service');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      state.editService = null;
      render();
    });
  }
};

const updateAppointmentStatus = async (appointment, status) => {
  await fetchJson(`/api/appointments/${appointment.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      clientId: appointment.clientId,
      barberId: appointment.barberId,
      serviceId: appointment.serviceId,
      date: appointment.date,
      time: appointment.time,
      status,
      notes: appointment.notes || ''
    })
  });
  await refresh();
};

const renderAppointments = (container) => {
  const clientOptions = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const barberOptions = state.barbers.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  const serviceOptions = state.services.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  const edit = state.editAppointment || { clientId: '', barberId: '', serviceId: '', date: '', time: '', status: 'Agendado', notes: '' };
  const buttonLabel = state.editAppointment ? 'Atualizar agendamento' : 'Salvar agendamento';

  container.innerHTML = `
    <div class="card">
      <h3>${state.editAppointment ? 'Editar agendamento' : 'Novo agendamento'}</h3>
      <form id="appointment-form">
        <select name="clientId" required><option value="">Selecione o cliente</option>${clientOptions}</select>
        <select name="barberId" required><option value="">Selecione o barbeiro</option>${barberOptions}</select>
        <select name="serviceId" required><option value="">Selecione o serviço</option>${serviceOptions}</select>
        <input name="date" type="date" required value="${safeAttr(edit.date)}" />
        <input name="time" type="time" required value="${safeAttr(edit.time)}" />
        <select name="status">
          <option value="Agendado" ${edit.status === 'Agendado' ? 'selected' : ''}>Agendado</option>
          <option value="Concluido" ${edit.status === 'Concluido' ? 'selected' : ''}>Concluído</option>
          <option value="Cancelado" ${edit.status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
        </select>
        <textarea name="notes" placeholder="Observacoes">${escapeHtml(edit.notes)}</textarea>
        <div>
          <button class="primary">${buttonLabel}</button>
          ${state.editAppointment ? '<button type="button" id="cancel-appointment" class="small-button">Cancelar</button>' : ''}
        </div>
      </form>
    </div>
    <div class="card agenda-wrapper">
      <h3>Agenda</h3>
      <div class="agenda-cards">
        ${state.appointments.map((a) => {
          const wa = whatsappLink(a.clientPhone);
          return `
            <article class="agenda-card">
              <div>
                <strong>${escapeHtml(a.clientName)}</strong>
                <span>${formatDate(a.date)} - ${escapeHtml(a.time)} · ${escapeHtml(a.serviceName)}</span>
                <small>${escapeHtml(a.barberName)}${a.clientPhone ? ` · ${escapeHtml(a.clientPhone)}` : ''}</small>
              </div>
              <span class="status ${safeAttr(a.status)}">${escapeHtml(formatStatus(a.status))}</span>
              <div class="table-actions">
                ${wa ? `<a class="small-button whatsapp-action" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
                ${a.status !== 'Concluido' ? `<button type="button" class="small-button complete-appointment" data-id="${a.id}">Concluir</button>` : ''}
                ${a.status !== 'Cancelado' ? `<button type="button" class="small-button cancel-status-appointment" data-id="${a.id}">Cancelar</button>` : `<button type="button" class="small-button reopen-appointment" data-id="${a.id}">Reabrir</button>`}
                <button type="button" class="small-button edit-appointment" data-id="${a.id}">Editar</button>
                <button type="button" class="small-button delete-appointment" data-id="${a.id}">Excluir</button>
              </div>
            </article>
          `;
        }).join('')}
      </div>
      <table>
        <thead><tr><th>Cliente</th><th>Barbeiro</th><th>Serviço</th><th>Data</th><th>Hora</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>${state.appointments.map(a => `<tr><td>${escapeHtml(a.clientName)}</td><td>${escapeHtml(a.barberName)}</td><td>${escapeHtml(a.serviceName)}</td><td>${escapeHtml(a.date)}</td><td>${escapeHtml(a.time)}</td><td><span class="status ${safeAttr(a.status)}">${escapeHtml(formatStatus(a.status))}</span></td><td><button type="button" class="small-button edit-appointment" data-id="${a.id}">Editar</button><button type="button" class="small-button delete-appointment" data-id="${a.id}">Excluir</button></td></tr>`).join('')}</tbody>
      </table>
    </div>
  `;

  const form = $('#appointment-form');
  form.querySelector('[name="clientId"]').value = edit.clientId || '';
  form.querySelector('[name="barberId"]').value = edit.barberId || '';
  form.querySelector('[name="serviceId"]').value = edit.serviceId || '';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const body = {
      clientId: formData.get('clientId'),
      barberId: formData.get('barberId'),
      serviceId: formData.get('serviceId'),
      date: formData.get('date'),
      time: formData.get('time'),
      status: formData.get('status'),
      notes: formData.get('notes')
    };

    if (state.editAppointment) {
      await fetchJson(`/api/appointments/${state.editAppointment.id}`, { method: 'PUT', body: JSON.stringify(body) });
      state.editAppointment = null;
    } else {
      await fetchJson('/api/appointments', { method: 'POST', body: JSON.stringify(body) });
    }

    await refresh();
  });

  document.querySelectorAll('.complete-appointment').forEach((button) => {
    button.addEventListener('click', async () => {
      const appointment = state.appointments.find((item) => item.id === Number(button.dataset.id));
      if (appointment) await updateAppointmentStatus(appointment, 'Concluido');
    });
  });

  document.querySelectorAll('.cancel-status-appointment').forEach((button) => {
    button.addEventListener('click', async () => {
      const appointment = state.appointments.find((item) => item.id === Number(button.dataset.id));
      if (appointment) await updateAppointmentStatus(appointment, 'Cancelado');
    });
  });

  document.querySelectorAll('.reopen-appointment').forEach((button) => {
    button.addEventListener('click', async () => {
      const appointment = state.appointments.find((item) => item.id === Number(button.dataset.id));
      if (appointment) await updateAppointmentStatus(appointment, 'Agendado');
    });
  });

  document.querySelectorAll('.edit-appointment').forEach((button) => {
    button.addEventListener('click', () => {
      const appointment = state.appointments.find((item) => item.id === Number(button.dataset.id));
      state.editAppointment = appointment;
      render();
    });
  });

  document.querySelectorAll('.delete-appointment').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetchJson(`/api/appointments/${button.dataset.id}`, { method: 'DELETE' });
      await refresh();
    });
  });

  const cancelButton = $('#cancel-appointment');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      state.editAppointment = null;
      render();
    });
  }
};

const renderUsers = (container) => {
  const edit = state.editUser || { username: '', password: '', role: 'attendant' };
  const buttonLabel = state.editUser ? 'Atualizar usuário' : 'Salvar usuário';

  container.innerHTML = `
    <div class="card">
      <h3>${state.editUser ? 'Editar usuário' : 'Novo usuário'}</h3>
      <form id="user-form">
        <input name="username" placeholder="Usuario" required value="${safeAttr(edit.username)}" />
        <input name="password" type="password" placeholder="Senha" ${state.editUser ? '' : 'required'} />
        <select name="role" required>
          <option value="attendant" ${edit.role === 'attendant' ? 'selected' : ''}>Atendente</option>
          <option value="manager" ${edit.role === 'manager' ? 'selected' : ''}>Gerente</option>
          <option value="admin" ${edit.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
        <div>
          <button class="primary">${buttonLabel}</button>
          ${state.editUser ? '<button type="button" id="cancel-user" class="small-button">Cancelar</button>' : ''}
        </div>
      </form>
    </div>
    <div class="card table-wrapper">
      <h3>Lista de usuários</h3>
      ${state.users.length === 0 ? '<p class="message">Nenhum usuário cadastrado.</p>' : `
        <table>
          <thead><tr><th>Usuário</th><th>Função</th><th>Ações</th></tr></thead>
          <tbody>${state.users.map(u => `<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.role)}</td><td><button type="button" class="small-button edit-user" data-id="${u.id}">Editar</button><button type="button" class="small-button delete-user" data-id="${u.id}">Excluir</button></td></tr>`).join('')}</tbody>
        </table>
      `}
    </div>
  `;

  $('#user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const body = {
      username: formData.get('username'),
      password: formData.get('password'),
      role: formData.get('role')
    };

    try {
      if (state.editUser) {
        if (!body.password) delete body.password;
        await fetchJson(`/api/users/${state.editUser.id}`, { method: 'PUT', body: JSON.stringify(body) });
        state.editUser = null;
      } else {
        await fetchJson('/api/users', { method: 'POST', body: JSON.stringify(body) });
      }
      await refresh();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  });

  document.querySelectorAll('.edit-user').forEach((button) => {
    button.addEventListener('click', () => {
      const user = state.users.find((item) => item.id === Number(button.dataset.id));
      state.editUser = user;
      render();
    });
  });

  document.querySelectorAll('.delete-user').forEach((button) => {
    button.addEventListener('click', async () => {
      if (Number(button.dataset.id) === state.user.id) {
        alert('Não é possível excluir seu próprio usuário.');
        return;
      }
      try {
        await fetchJson(`/api/users/${button.dataset.id}`, { method: 'DELETE' });
        await refresh();
      } catch (err) {
        alert('Erro: ' + err.message);
      }
    });
  });

  const cancelButton = $('#cancel-user');
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      state.editUser = null;
      render();
    });
  }
};

const renderReports = (container) => {
  const report = state.report || { summary: { appointments: 0, totalRevenue: 0, scheduledCount: 0, completedCount: 0, canceledCount: 0 }, byBarber: [] };

  container.innerHTML = `
    <div class="card">
      <h3>Filtro de período</h3>
      <form id="report-form">
        <input name="start" type="date" value="${state.reportRange.start}" />
        <input name="end" type="date" value="${state.reportRange.end}" />
        <button class="primary">Atualizar relatório</button>
      </form>
    </div>
    <div class="card">
      <h3>Resumo</h3>
      <div class="message">
        <p>Total de agendamentos: <strong>${report.summary.appointments}</strong></p>
        <p>Agendados: <strong>${report.summary.scheduledCount}</strong></p>
        <p>Concluídos: <strong>${report.summary.completedCount}</strong></p>
        <p>Cancelados: <strong>${report.summary.canceledCount}</strong></p>
        <p>Faturamento: <strong>${money(report.summary.totalRevenue)}</strong></p>
      </div>
    </div>
    <div class="card table-wrapper">
      <h3>Receita por barbeiro</h3>
      <table>
        <thead><tr><th>Barbeiro</th><th>Agendamentos</th><th>Faturamento</th></tr></thead>
        <tbody>${report.byBarber.map(b => `<tr><td>${escapeHtml(b.barberName)}</td><td>${escapeHtml(b.totalAppointments)}</td><td>${money(b.revenue)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  `;

  $('#report-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    state.reportRange.start = formData.get('start');
    state.reportRange.end = formData.get('end');
    await loadReport();
    render();
  });
};

const refresh = async () => {
  await loadAll();
  if (state.view === 'reports') {
    await loadReport();
  }
  if (state.view === 'users') {
    await loadUsers();
  }
  render();
};

const bindNavigation = () => {
  document.querySelectorAll('nav button').forEach((button) => {
    button.addEventListener('click', async () => {
      document.querySelectorAll('nav button').forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      state.view = button.dataset.view;
      state.editClient = null;
      state.editBarber = null;
      state.editService = null;
      state.editAppointment = null;
      state.editUser = null;
      await refresh();
    });
  });

  $('#logout').addEventListener('click', () => {
    logout();
  });
};

const init = async () => {
  bindNavigation();
  await loadProfile();
  if (state.loggedIn) {
    await refresh();
  } else {
    render();
  }
};

init();


