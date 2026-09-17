import { el, clearEl, showToast } from './utils.js';
import { getSession, onAuthStateChange, signOut, getCurrentProfile } from './auth.js';
import { listProjects, subscribeProjects, getProject } from './db.js';
import { renderLogin, renderPasswordSetup } from './views/login.js';
import { renderProjectPicker } from './views/projectPicker.js';
import { renderProjectDetail } from './views/projectDetail.js';
import { renderItemForm } from './views/itemForm.js';
import { renderUserManagement } from './views/userManagement.js';
import { renderActivityLog } from './views/activityLog.js';

const state = {
  view: 'projects',
  statusFilter: 'active',
  searchQuery: '',
  currentProject: null,
  items: [],
  projects: [],
  currentUser: null,
  currentProfile: null,
};

let unsubProjects = null;

export async function initApp(rootEl) {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    console.error('Failed to restore session:', error);
    showToast('We could not restore your session. Please sign in again.', 'error');
  }
  if (session && isPasswordSetupLink()) {
    renderPasswordSetup(rootEl, () => enterApp(rootEl, session));
  } else if (session) {
    await enterApp(rootEl, session);
  } else {
    renderLogin(rootEl, async () => {
      const session2 = await getSession();
      await enterApp(rootEl, session2);
    });
  }

  onAuthStateChange((session3, event) => {
    if (session3 && (event === 'PASSWORD_RECOVERY' || isPasswordSetupLink())) {
      renderPasswordSetup(rootEl, () => enterApp(rootEl, session3));
      return;
    }
    if (!session3 && state.view !== 'login') {
      state.view = 'login';
      state.currentUser = null;
      state.currentProfile = null;
      if (unsubProjects) { unsubProjects(); unsubProjects = null; }
      renderLogin(rootEl, async () => {
        const s = await getSession();
        await enterApp(rootEl, s);
      });
    }
  });
}

function isPasswordSetupLink() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  return ['invite', 'recovery'].includes(hash.get('type')) || query.has('code');
}

async function enterApp(rootEl, session) {
  if (!session?.user) {
    renderLogin(rootEl, async () => {
      const nextSession = await getSession();
      await enterApp(rootEl, nextSession);
    });
    return;
  }
  state.currentUser = session.user;
  try {
    state.currentProfile = await getCurrentProfile(session.user.id);
  } catch (error) {
    console.error('Failed to load profile:', error);
    state.currentProfile = null;
    showToast('Your profile details could not be loaded.', 'warning');
  }
  if (!state.currentProfile?.active) {
    try { await signOut(); } catch { /* The local auth listener will still return to sign-in. */ }
    showToast('This account is inactive. Ask an administrator to restore access.', 'error');
    renderLogin(rootEl, async () => {
      const nextSession = await getSession();
      await enterApp(rootEl, nextSession);
    });
    return;
  }
  renderShell(rootEl);
  navigate('projects');
  refreshProjects();
  unsubProjects = subscribeProjects(() => refreshProjects());
}

function renderShell(rootEl) {
  clearEl(rootEl);
  const isAdmin = state.currentProfile?.role === 'admin';
  const navigation = el('nav', { className: 'app-nav', 'aria-label': 'Primary navigation' },
    navButton('Projects', 'projects'),
    isAdmin ? navButton('Activity', 'activity') : null,
    isAdmin ? navButton('Users', 'users') : null,
  );
  const header = el('header', { className: 'app-header' },
    el('div', { className: 'header-brand' },
      el('button', { className: 'logo', type: 'button', 'aria-label': 'Engineer service calculator home', onClick() { navigate('projects'); } },
        el('img', { className: 'header-brand-logo', src: '/assets/spacial-logo-blue.svg', alt: 'Spacial' }),
        el('span', { className: 'product-name' }, 'Engineer service calculator')),
      navigation,
    ),
    el('div', { className: 'user-info' },
      el('span', { className: 'user-identity' },
        el('strong', null, state.currentProfile?.full_name || state.currentUser?.email || ''),
        isAdmin ? el('span', { className: 'badge badge-admin' }, 'Admin') : null,
      ),
      el('button', { className: 'btn btn-ghost btn-sm', onClick: async () => {
        try {
          await signOut();
        } catch (error) {
          console.error('Failed to sign out:', error);
          showToast('Sign out failed. Please try again.', 'error');
        }
      } }, 'Sign Out'),
    ),
  );
  const main = el('main', { className: 'main-content', id: 'main-content', tabindex: '-1' });
  rootEl.appendChild(header);
  rootEl.appendChild(main);

  function navButton(label, view) {
    return el('button', {
      className: 'app-nav-button', type: 'button', 'data-view': view,
      onClick() { navigate(view); },
    }, label);
  }
}

function getMain() { return document.getElementById('main-content'); }

async function refreshProjects() {
  try {
    state.projects = await listProjects();
  } catch (e) {
    console.error('Failed to load projects:', e);
    showToast('Projects could not be loaded. Please try again.', 'error');
  }
  if (state.view === 'projects') renderCurrentView();
}

function navigate(view, data) {
  if ((view === 'users' || view === 'activity') && state.currentProfile?.role !== 'admin') {
    view = 'projects';
    showToast('Administrator access is required.', 'error');
  }
  state.view = view;
  if (data) Object.assign(state, data);
  updateNavigation();
  renderCurrentView();
}

function updateNavigation() {
  document.querySelectorAll('.app-nav-button').forEach((button) => {
    const active = button.getAttribute('data-view') === state.view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

async function renderCurrentView() {
  const main = getMain();
  if (!main) return;

  if (state.view === 'projects') {
    renderProjectPicker(main, state, {
      onOpenProject: async (p) => {
        try {
          state.currentProject = await getProject(p.projectNumber);
          navigate('project-detail');
        } catch (error) {
          console.error('Failed to open project:', error);
          showToast('This project could not be opened. Please try again.', 'error');
        }
      },
      onProjectsChanged: refreshProjects,
    });
  } else if (state.view === 'project-detail') {
    await renderProjectDetail(main, state, {
      onBack: (toProjects) => navigate(toProjects ? 'projects' : 'project-detail'),
      onOpenItem: (item) => navigate('item-form', { _itemId: item.id, _moduleId: null }),
      onAddItem: (moduleId) => navigate('item-form', { _itemId: null, _moduleId: moduleId }),
      onDeleted: () => { state.currentProject = null; navigate('projects'); },
    });
  } else if (state.view === 'item-form') {
    await renderItemForm(main, state, {
      moduleId: state._moduleId,
      itemId: state._itemId,
      onBack: (toProjects) => navigate(toProjects ? 'projects' : 'project-detail'),
      onSaved: async (savedId, stayOnForm) => {
        try {
          state.currentProject = await getProject(state.currentProject.projectNumber);
        } catch (error) {
          console.error('Failed to refresh project:', error);
          showToast('The calculation was saved, but the project could not be refreshed.', 'warning');
          return;
        }
        if (stayOnForm) {
          state._itemId = savedId;
          state._moduleId = null;
        } else {
          navigate('project-detail');
        }
      },
    });
  } else if (state.view === 'users' && state.currentProfile?.role === 'admin') {
    await renderUserManagement(main, state, { onBack: () => navigate('projects') });
  } else if (state.view === 'activity' && state.currentProfile?.role === 'admin') {
    await renderActivityLog(main, state, { onBack: () => navigate('projects') });
  } else {
    navigate('projects');
  }
}
