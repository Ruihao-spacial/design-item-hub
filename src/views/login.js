import { el, clearEl, showToast } from '../utils.js';
import { requestPasswordReset, signIn, updatePassword } from '../auth.js';

export function renderLogin(container, onSuccess) {
  clearEl(container);
  let email = '';
  let password = '';
  let submitting = false;

  const emailInput = el('input', {
    id: 'login-email', className: 'form-input', type: 'email', placeholder: 'you@company.com', autocomplete: 'email', required: 'true',
    onInput(e) { email = e.target.value; },
  });
  const passwordInput = el('input', {
    id: 'login-password', className: 'form-input', type: 'password', placeholder: '••••••••', autocomplete: 'current-password', required: 'true',
    onInput(e) { password = e.target.value; },
  });
  const submitBtn = el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, 'Sign In');

  const resetBtn = el('button', {
    className: 'btn btn-ghost btn-sm', type: 'button',
    async onClick() {
      if (!email.trim()) {
        showToast('Enter your email address first.', 'warning');
        emailInput.focus();
        return;
      }
      resetBtn.disabled = true;
      let result;
      try {
        result = await requestPasswordReset(email.trim());
      } catch (error) {
        console.error('Password reset request failed:', error);
        result = { success: false, error: 'Password reset is unavailable. Please try again.' };
      } finally {
        resetBtn.disabled = false;
      }
      showToast(result.success ? 'Password reset link sent. Check your email.' : (result.error || 'Unable to send a reset link.'), result.success ? 'success' : 'error');
    },
  }, 'Forgot password?');

  async function submit() {
    if (submitting) return;
    if (!email || !password) { showToast('Enter your email and password.', 'warning'); return; }
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    let result;
    try {
      result = await signIn(email.trim(), password);
    } catch (error) {
      console.error('Sign in failed:', error);
      result = { success: false, error: 'Sign in is unavailable. Please try again.' };
    }
    submitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
    if (!result.success) {
      showToast(result.error || 'Sign in failed.', 'error');
      return;
    }
    onSuccess(result.user);
  }

  container.appendChild(el('main', { className: 'login-page', id: 'main-content' },
    el('form', { className: 'login-card', onSubmit(e) { e.preventDefault(); submit(); } },
      el('div', { className: 'logo-mark', 'aria-hidden': 'true' }, 'ES'),
      el('h1', null, 'Engineer service calculator'),
      el('div', { className: 'subtitle' }, 'Sign in with your company account'),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label', htmlFor: 'login-email' }, 'Email'), emailInput),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label', htmlFor: 'login-password' }, 'Password'), passwordInput),
      submitBtn,
      el('div', { style: { display: 'flex', justifyContent: 'center', marginTop: '0.5rem' } }, resetBtn),
      el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)', textAlign: 'center', marginTop: '1rem' } },
        'No account yet? Ask your admin to invite you.'),
    ),
  ));
  emailInput.focus();
}

export function renderPasswordSetup(container, onSuccess) {
  clearEl(container);
  let password = '';
  let confirmation = '';
  let submitting = false;

  const passwordInput = el('input', {
    id: 'setup-password', className: 'form-input', type: 'password', autocomplete: 'new-password', minlength: '10', required: 'true',
    onInput(e) { password = e.target.value; },
  });
  const confirmationInput = el('input', {
    id: 'setup-password-confirmation', className: 'form-input', type: 'password', autocomplete: 'new-password', minlength: '10', required: 'true',
    onInput(e) { confirmation = e.target.value; },
  });
  const submitBtn = el('button', { className: 'btn btn-primary btn-block', type: 'submit' }, 'Set Password');

  async function submit() {
    if (submitting) return;
    if (password.length < 10) { showToast('Use at least 10 characters.', 'warning'); return; }
    if (password !== confirmation) { showToast('Passwords do not match.', 'warning'); return; }
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    let result;
    try {
      result = await updatePassword(password);
    } catch (error) {
      console.error('Password update failed:', error);
      result = { success: false, error: 'Password update is unavailable. Please try again.' };
    } finally {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Set Password';
    }
    if (!result.success) { showToast(result.error || 'Password could not be updated.', 'error'); return; }
    window.history.replaceState({}, document.title, window.location.pathname);
    showToast('Password saved.', 'success');
    onSuccess();
  }

  container.appendChild(el('main', { className: 'login-page', id: 'main-content' },
    el('form', { className: 'login-card', onSubmit(e) { e.preventDefault(); submit(); } },
      el('div', { className: 'logo-mark', 'aria-hidden': 'true' }, 'ES'),
      el('h1', null, 'Set your password'),
      el('div', { className: 'subtitle' }, 'Finish accepting your invitation or password reset.'),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label', htmlFor: 'setup-password' }, 'New password'), passwordInput),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label', htmlFor: 'setup-password-confirmation' }, 'Confirm password'), confirmationInput),
      submitBtn,
    ),
  ));
  passwordInput.focus();
}
