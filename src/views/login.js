import { el, clearEl, showToast } from '../utils.js';
import { signIn } from '../auth.js';

export function renderLogin(container, onSuccess) {
  clearEl(container);
  let email = '';
  let password = '';
  let submitting = false;

  const emailInput = el('input', {
    className: 'form-input', type: 'email', placeholder: 'you@company.com', autocomplete: 'email',
    onInput(e) { email = e.target.value; },
    onKeydown(e) { if (e.key === 'Enter') submit(); },
  });
  const passwordInput = el('input', {
    className: 'form-input', type: 'password', placeholder: '••••••••', autocomplete: 'current-password',
    onInput(e) { password = e.target.value; },
    onKeydown(e) { if (e.key === 'Enter') submit(); },
  });
  const submitBtn = el('button', { className: 'btn btn-primary btn-block', type: 'button', onClick: submit }, 'Sign In');

  async function submit() {
    if (submitting) return;
    if (!email || !password) { showToast('Enter your email and password.', 'warning'); return; }
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    const result = await signIn(email.trim(), password);
    submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
    if (!result.success) {
      showToast(result.error || 'Sign in failed.', 'error');
      return;
    }
    onSuccess(result.user);
  }

  container.appendChild(el('div', { className: 'login-page' },
    el('div', { className: 'login-card' },
      el('div', { className: 'logo-mark' }, 'SE'),
      el('h1', null, 'Design Item Hub'),
      el('div', { className: 'subtitle' }, 'Sign in with your company account'),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Email'), emailInput),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Password'), passwordInput),
      submitBtn,
      el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)', textAlign: 'center', marginTop: '1rem' } },
        'No account yet? Ask your admin to invite you.'),
    ),
  ));
  emailInput.focus();
}
