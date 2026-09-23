import { el, clearEl, formatDate, showToast } from '../utils.js';
import {
  createManagedUser,
  listManagedUsers,
  updateManagedUserRole,
  updateManagedUserStatus,
} from '../admin.js';

export async function renderUserManagement(container, state, { onBack } = {}) {
  clearEl(container);
  const currentUserId = state.currentUser?.id;
  const header = el('div', { className: 'section-header' },
    el('div', null,
      onBack ? el('div', { className: 'breadcrumb' },
        el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(); } }, 'Projects'),
        el('span', { className: 'sep' }, '/'),
        el('span', null, 'User management')) : null,
      el('h1', null, 'User management'),
    ),
    el('button', { className: 'btn btn-primary', type: 'button', onClick() { showCreateUserModal(load); } }, '+ Add user'),
  );
  const status = el('div', { role: 'status', 'aria-live': 'polite', style: { color: 'var(--ink-secondary)', fontSize: '0.9rem', marginTop: '1rem' } });
  const content = el('div', { style: { marginTop: '1rem' } });
  container.append(header, status, content);

  async function load() {
    status.textContent = 'Loading users…';
    clearEl(content);
    try {
      const users = await listManagedUsers();
      status.textContent = '';
      renderUsersTable(content, users, currentUserId, load);
    } catch (error) {
      status.textContent = '';
      content.appendChild(el('div', { className: 'error-banner', role: 'alert' },
        error.message || 'Users could not be loaded.',
        el('button', { className: 'btn btn-sm', type: 'button', style: { marginLeft: '0.75rem' }, onClick: load }, 'Try again'),
      ));
    }
  }

  await load();
}

function renderUsersTable(container, users, currentUserId, reload) {
  if (!users.length) {
    container.appendChild(el('div', { className: 'panel empty-state' },
      el('h3', null, 'No users'),
      el('p', null, 'Create a user to give someone access.'),
    ));
    return;
  }

  const activeAdmins = users.filter(user => normalizeRole(user) === 'admin' && normalizeStatus(user) === 'active').length;
  const table = el('table', { className: 'data-table' });
  table.appendChild(el('caption', { className: 'sr-only' }, 'Application users'));
  table.appendChild(el('thead', null, el('tr', null,
    el('th', { scope: 'col' }, 'User'),
    el('th', { scope: 'col' }, 'Role'),
    el('th', { scope: 'col' }, 'Status'),
    el('th', { scope: 'col' }, 'Joined'),
    el('th', { scope: 'col' }, 'Last sign-in'),
  )));
  const body = el('tbody');

  users.forEach((user) => {
    const userId = user.id || user.user_id;
    const role = normalizeRole(user);
    const userStatus = normalizeStatus(user);
    const isSelf = userId === currentUserId;
    const isLastActiveAdmin = role === 'admin' && userStatus === 'active' && activeAdmins <= 1;
    const roleSelect = selectControl('Role for ' + displayName(user), ['member', 'admin'], role);
    const statusSelect = selectControl('Status for ' + displayName(user), ['active', 'disabled'], userStatus);

    roleSelect.disabled = isSelf || isLastActiveAdmin;
    statusSelect.disabled = isSelf || isLastActiveAdmin;
    const safeguard = isSelf
      ? 'You cannot change your own access here.'
      : isLastActiveAdmin ? 'Keep at least one active administrator.' : '';
    if (safeguard) {
      roleSelect.title = safeguard;
      statusSelect.title = safeguard;
    }

    roleSelect.addEventListener('change', async () => {
      await updateWithRollback(roleSelect, role, async value => updateManagedUserRole(userId, value, userStatus === 'active'), 'Role updated.', reload);
    });
    statusSelect.addEventListener('change', async () => {
      const nextStatus = statusSelect.value;
      const verb = nextStatus === 'disabled' ? 'disable' : 'reactivate';
      if (!window.confirm(`Are you sure you want to ${verb} ${displayName(user)}?`)) {
        statusSelect.value = userStatus;
        return;
      }
      await updateWithRollback(statusSelect, userStatus, async value => updateManagedUserStatus(userId, value, role),
        nextStatus === 'disabled' ? 'User disabled.' : 'User reactivated.', reload);
    });

    body.appendChild(el('tr', null,
      el('td', null,
        el('div', { style: { fontWeight: '600' } }, displayName(user), isSelf ? ' (you)' : ''),
        el('div', { style: { color: 'var(--ink-secondary)', fontSize: '0.8rem' } }, user.email || '—'),
        safeguard ? el('div', { style: { color: 'var(--ink-tertiary)', fontSize: '0.75rem' } }, safeguard) : null,
      ),
      el('td', null, roleSelect),
      el('td', null, statusSelect),
      el('td', null, formatDate(user.created_at || user.createdAt)),
      el('td', null, formatDate(user.last_sign_in_at || user.lastSignInAt)),
    ));
  });

  table.appendChild(body);
  container.appendChild(el('div', { className: 'panel table-scroll' }, table));
}

function selectControl(label, options, value) {
  const select = el('select', { className: 'form-select', 'aria-label': label, style: { width: 'auto', minWidth: '7rem' } });
  options.forEach((option) => {
    select.appendChild(el('option', { value: option, selected: option === value }, capitalize(option)));
  });
  return select;
}

async function updateWithRollback(control, previousValue, update, successMessage, reload) {
  control.disabled = true;
  try {
    await update(control.value);
    showToast(successMessage, 'success');
    await reload();
  } catch (error) {
    control.value = previousValue;
    control.disabled = false;
    showToast(error.message || 'The user could not be updated.', 'error');
  }
}

function showCreateUserModal(onCreated) {
  let submitting = false;
  const previousFocus = document.activeElement;
  const backdrop = el('div', { className: 'modal-backdrop' });
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    previousFocus?.focus?.();
  };
  const onKeydown = (event) => { if (event.key === 'Escape' && !submitting) close(); };

  const nameInput = el('input', { id: 'managed-user-name', className: 'form-input', type: 'text', autocomplete: 'name', required: true });
  const emailInput = el('input', { id: 'managed-user-email', className: 'form-input', type: 'email', autocomplete: 'email', required: true });
  const passwordInput = el('input', {
    id: 'managed-user-password', className: 'form-input', type: 'password', autocomplete: 'new-password',
    minlength: '10', pattern: '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,128}', required: true,
  });
  const roleSelect = selectControl('New user role', ['member', 'admin'], 'member');
  roleSelect.id = 'managed-user-role';
  const submitButton = el('button', { className: 'btn btn-primary', type: 'submit' }, 'Create user');

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    const fullName = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const temporaryPassword = passwordInput.value;
    if (!fullName || !email) { showToast('Name and email are required.', 'warning'); return; }
    if (temporaryPassword.length < 10 || !/[a-z]/.test(temporaryPassword) || !/[A-Z]/.test(temporaryPassword) || !/[0-9]/.test(temporaryPassword)) {
      showToast('Use 10 or more characters with uppercase, lowercase, and a number.', 'warning');
      return;
    }
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating…';
    try {
      await createManagedUser({ email, fullName, role: roleSelect.value, temporaryPassword });
      close();
      showToast('User created. Share the temporary password securely.', 'success');
      await onCreated();
    } catch (error) {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Create User';
      showToast(error.message || 'The user could not be created.', 'error');
    }
  }

  const form = el('form', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'create-user-title', onSubmit: submit },
    el('div', { className: 'modal-header' },
      el('h3', { id: 'create-user-title' }, 'Add user'),
      el('button', { className: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Close add user dialog', onClick: close }, '×'),
    ),
    el('div', { className: 'modal-body' },
      field('managed-user-name', 'Full name', nameInput),
      field('managed-user-email', 'Email', emailInput),
      field('managed-user-password', 'Temporary password', passwordInput,
        '10–128 characters with uppercase, lowercase, and a number. Ask the user to change it after signing in.'),
      field('managed-user-role', 'Role', roleSelect),
    ),
    el('div', { className: 'modal-footer' },
      el('button', { className: 'btn', type: 'button', onClick: close }, 'Cancel'),
      submitButton,
    ),
  );
  backdrop.addEventListener('click', event => { if (event.target === backdrop && !submitting) close(); });
  backdrop.appendChild(form);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKeydown);
  nameInput.focus();
}

function field(id, label, control, helpText) {
  return el('div', { className: 'form-group' },
    el('label', { className: 'form-label', htmlFor: id }, label),
    control,
    helpText ? el('div', { style: { color: 'var(--ink-secondary)', fontSize: '0.78rem', marginTop: '0.25rem' } }, helpText) : null,
  );
}

function displayName(user) {
  return user.full_name || user.fullName || user.email || 'Unnamed user';
}

function normalizeRole(user) {
  return user.role === 'admin' ? 'admin' : 'member';
}

function normalizeStatus(user) {
  if (typeof user.active === 'boolean') return user.active ? 'active' : 'disabled';
  return (user.status === 'disabled' || user.banned_until || user.bannedUntil) ? 'disabled' : 'active';
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
