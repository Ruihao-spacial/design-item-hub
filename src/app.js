import { el, clearEl, showToast } from './utils.js';
import { getSession, onAuthStateChange, signOut, getCurrentProfile } from './auth.js';
import { listProjects, subscribeProjects, getProject } from './db.js';
import { renderLogin } from './views/login.js';
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
  const session = await getSession();
  if (session) {
    await enterApp(rootEl, session);
  } else {
    renderLogin(rootEl, async () => {
      const session2 = await getSession();
      await enterApp(rootEl, session2);
    });
  }

  onAuthStateChange((session3) => {
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

async function enterApp(rootEl, session) {
  state.currentUser = session.user;
  state.currentProfile = await getCurrentProfile(session.user.id);
  renderShell(rootEl);
  navigate('projects');
  refreshProjects();
  unsubProjects = subscribeProjects(() => refreshProjects());
}

function renderShell(rootEl) {
  clearEl(rootEl);
  const header = el('div', { className: 'app-header' },
    el('div', { className: 'logo', onClick() { navigate('projects'); } },
      el('div', { className: 'logo-mark' }, 'SE'), 'Design Item Hub'),
    el('div', { className: 'user-info' },
      state.currentProfile?.full_name || state.currentUser?.email || '',
      el('button', { className: 'btn btn-ghost btn-sm', onClick: async () => { await signOut(); } }, 'Sign Out'),
    ),
  );
  const main = el('div', { className: 'main-content', id: 'main-content' });
  rootEl.appendChild(header);
  rootEl.appendChild(main);
}

function getMain() { return document.getElementById('main-content'); }

async function refreshProjects() {
  try {
    state.projects = await listProjects();
  } catch (e) {
    console.error('Failed to load projects:', e);
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
        state.currentProject = await getProject(p.projectNumber);
        navigate('project-detail');
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
        state.currentProject = await getProject(state.currentProject.projectNumber);
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
