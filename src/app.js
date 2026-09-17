import { el, clearEl, showToast } from './utils.js';
import { getSession, onAuthStateChange, signOut, getCurrentProfile } from './auth.js';
import { listProjects, subscribeProjects, getProject } from './db.js';
import { renderLogin, renderPasswordSetup } from './views/login.js';
import { renderProjectPicker } from './views/projectPicker.js';
import { renderProjectDetail } from './views/projectDetail.js';
import { renderItemForm } from './views/itemForm.js';

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
  renderShell(rootEl);
  navigate('projects');
  refreshProjects();
  unsubProjects = subscribeProjects(() => refreshProjects());
}

function renderShell(rootEl) {
  clearEl(rootEl);
  const header = el('header', { className: 'app-header' },
    el('button', { className: 'logo', type: 'button', 'aria-label': 'Engineer service calculator home', onClick() { navigate('projects'); } },
      el('span', { className: 'logo-mark', 'aria-hidden': 'true' }, 'ES'), 'Engineer service calculator'),
    el('div', { className: 'user-info' },
      state.currentProfile?.full_name || state.currentUser?.email || '',
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
  state.view = view;
  if (data) Object.assign(state, data);
  renderCurrentView();
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
  }
}
