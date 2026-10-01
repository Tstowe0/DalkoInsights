/**
 * Permission groups. A group owns menu items and tools. A person belongs to one group.
 * Anyone left on Full access keeps every page, including FTP.
 * New people start in Everything no FTP. Admin always includes the owner and can always open Permissions.
 */

import { NAV_ITEMS as INSIGHT_NAV } from "../../portals/dalko/js/ui/nav.js?v=20260923-desk";
import { CLIENT_REPORT_BANDS, SECTIONS } from "../../portals/glassbox/js/catalog.js?v=20260923-fmcsa";
import { AUTH_ALLOWED_DOMAIN } from "./auth-config.js?v=20260915-app3";
import { getAccessToken, getEmail } from "./auth.js?v=20260930-directory";

const STORAGE_KEY = "dalko.permissions.v1";
const KNOWN_KEY = "dalko.permissions.known";
const ADMIN_ID = "admin";
const STAFF_ID = "everything-no-ftp";
const FTP_MENU = "integrations-ftp";
const OWNER_EMAIL = "terry.stowe@shipdalko.com";

/** @typedef {{ id: string, name: string, menus: string[], tools: string[] }} PermGroup */
/** @typedef {{ email: string, groupId: string }} PermMember */
/** @typedef {{ groups: PermGroup[], members: PermMember[], released: string[] }} PermStore */

const INSIGHT_PAGE_IDS = INSIGHT_NAV.filter((item) => item.id !== "changelog").map((item) => item.id);

const TOOL_SHORTCUTS = [
  { label: "Carrier Search", menu: "carrier-search", tool: "Carrier Search" },
  { label: "Zip Calculator", menu: "zip-calculator", tool: "Zip Calculator" },
  { label: "Currency Converter", menu: "currency-converter", tool: "Currency Converter" },
];
const SIDEBAR_TOOL_IDS = new Set(TOOL_SHORTCUTS.map((item) => item.tool));

/**
 * @typedef {{ label: string, menus?: string[], tools?: string[], children?: PermNode[] }} PermNode
 */

/** The sidebar, then the pages and tools that live under each section. */
function permissionTree() {
  return [
    { label: "Today", menus: ["home"] },
    {
      label: "Reports",
      menus: ["client-reports"],
      children: CLIENT_REPORT_BANDS.map((band) => ({
        label: band.label,
        children: band.tools.map((tool) => ({ label: tool.label, tools: [tool.id] })),
      })),
    },
    {
      label: "Client Uploads",
      menus: ["client-uploads"],
      children: (SECTIONS.find((section) => section.id === "client-uploads")?.tools || []).map((tool) => ({
        label: tool.label,
        tools: [tool.id],
      })),
    },
    {
      label: "DALKO Insights",
      menus: ["insights"],
      children: INSIGHT_NAV.filter((item) => item.id !== "changelog").map((item) => ({
        label: item.label,
        menus: [`insight:${item.id}`],
      })),
    },
    {
      label: "Tools",
      children: [
        ...TOOL_SHORTCUTS.map((item) => ({
          label: item.label,
          menus: [item.menu],
          tools: [item.tool],
        })),
        ...SECTIONS.filter((section) => section.id !== "client-uploads").map((section) => ({
          label: section.label,
          menus: [section.id],
          children: section.tools
            .filter((tool) => !SIDEBAR_TOOL_IDS.has(tool.id))
            .map((tool) => ({ label: tool.label, tools: [tool.id] })),
        })),
      ],
    },
    {
      label: "Settings",
      children: [
        { label: "Change log", menus: ["changelog"] },
        {
          label: "Integrations",
          menus: ["integrations"],
          children: [{ label: "FTP Rack", menus: [FTP_MENU] }],
        },
        { label: "Permissions", menus: ["permissions"] },
        { label: "Themes", menus: ["themes"] },
      ],
    },
  ];
}

/** @param {PermNode} node */
function grantsOf(node) {
  const menus = [...(node.menus || [])];
  const tools = [...(node.tools || [])];
  for (const child of node.children || []) {
    const sub = grantsOf(child);
    menus.push(...sub.menus);
    tools.push(...sub.tools);
  }
  return { menus, tools };
}

function emptyStore() {
  return { groups: /** @type {PermGroup[]} */ ([]), members: /** @type {PermMember[]} */ ([]), released: /** @type {string[]} */ ([]) };
}

/** Every menu and tool, optionally skipping a menu id. @param {Set<string>} [skipMenus] */
function collectGrants(skipMenus = new Set()) {
  /** @type {Set<string>} */
  const menus = new Set();
  /** @type {Set<string>} */
  const tools = new Set();
  /** @param {PermNode} node */
  const walk = (node) => {
    for (const id of node.menus || []) if (!skipMenus.has(id)) menus.add(id);
    for (const id of node.tools || []) tools.add(id);
    for (const child of node.children || []) walk(child);
  };
  for (const node of permissionTree()) walk(node);
  return { menus: [...menus], tools: [...tools] };
}

/** Menus required to open the page that holds a grant. @param {string[]} menus @param {string[]} tools */
function ancestorMenusFor(menus, tools) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  /** @param {PermNode} node @param {string[]} ancestors */
  const walk = (node, ancestors) => {
    for (const id of node.menus || []) map.set(`m:${id}`, ancestors);
    for (const id of node.tools || []) map.set(`t:${id}`, ancestors);
    const next = ancestors.concat(node.menus || []);
    for (const child of node.children || []) walk(child, next);
  };
  for (const node of permissionTree()) walk(node, []);
  const extra = new Set();
  for (const id of menus) for (const parent of map.get(`m:${id}`) || []) extra.add(parent);
  for (const id of tools) for (const parent of map.get(`t:${id}`) || []) extra.add(parent);
  return [...extra];
}

/** @param {PermStore} store */
function ensureAdmin(store) {
  let changed = false;
  let admin = store.groups.find((group) => group.id === ADMIN_ID);
  if (!admin) {
    admin = { id: ADMIN_ID, name: "Admin", menus: ["permissions"], tools: [] };
    store.groups.unshift(admin);
    changed = true;
  } else if (store.groups[0]?.id !== ADMIN_ID) {
    store.groups = [admin, ...store.groups.filter((group) => group.id !== ADMIN_ID)];
    changed = true;
  }
  if (!admin.menus.includes("permissions")) {
    admin.menus = [...admin.menus, "permissions"];
    changed = true;
  }
  const owner = store.members.find((member) => member.email === OWNER_EMAIL);
  if (!owner) {
    store.members.push({ email: OWNER_EMAIL, groupId: ADMIN_ID });
    changed = true;
  } else if (owner.groupId !== ADMIN_ID) {
    owner.groupId = ADMIN_ID;
    changed = true;
  }
  return changed;
}

/** Built-in group for everyone except the owner. FTP starts off. @param {PermStore} store */
function ensureStaff(store) {
  let changed = false;
  let staff = store.groups.find((group) => group.id === STAFF_ID);
  if (!staff) {
    const grants = collectGrants(new Set([FTP_MENU]));
    staff = { id: STAFF_ID, name: "Everything no FTP", menus: grants.menus, tools: grants.tools };
    changed = true;
  }
  const admin = store.groups.find((group) => group.id === ADMIN_ID);
  const rest = store.groups.filter((group) => group.id !== ADMIN_ID && group.id !== STAFF_ID);
  const next = [admin, staff, ...rest].filter(Boolean);
  const same =
    next.length === store.groups.length && next.every((group, index) => store.groups[index] === group);
  if (!same) {
    store.groups = next;
    changed = true;
  }
  return changed;
}

/** @returns {PermStore} */
function readPermissions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const data = JSON.parse(raw);
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const members = Array.isArray(data?.members) ? data.members : [];
    return {
      groups: groups
        .filter((group) => group && typeof group.id === "string")
        .map((group) => ({
          id: group.id,
          name: String(group.name || "Group").slice(0, 60),
          menus: Array.isArray(group.menus) ? group.menus.map(String) : [],
          tools: Array.isArray(group.tools) ? group.tools.map(String) : [],
        })),
      members: [...members.reduce((map, member) => {
        if (!member || typeof member.email !== "string" || typeof member.groupId !== "string") return map;
        const email = member.email.trim().toLowerCase();
        if (email.includes("@")) map.set(email, member.groupId);
        return map;
      }, new Map())].map(([email, groupId]) => ({ email, groupId })),
      released: [...new Set(
        (Array.isArray(data?.released) ? data.released : [])
          .map((email) => String(email || "").trim().toLowerCase())
          .filter((email) => email.includes("@"))
      )],
    };
  } catch {
    return emptyStore();
  }
}

/** @returns {PermStore} */
export function loadPermissions() {
  const store = readPermissions();
  const adminChanged = ensureAdmin(store);
  const staffChanged = ensureStaff(store);
  const repaired = repairMembers(store);
  const parents = repairGrantParents(store);
  if (adminChanged || staffChanged || repaired || parents) savePermissions(store);
  return store;
}

/** A checked page or tool also keeps the menu that opens it. @param {PermStore} store */
function repairGrantParents(store) {
  let changed = false;
  for (const group of store.groups) {
    for (const id of ancestorMenusFor(group.menus, group.tools)) {
      if (group.menus.includes(id)) continue;
      group.menus.push(id);
      changed = true;
    }
  }
  return changed;
}

/** People left pointing at a group that no longer exists land in Everything no FTP. @param {PermStore} store */
function repairMembers(store) {
  const ids = new Set(store.groups.map((group) => group.id));
  let changed = false;
  for (const member of store.members) {
    if (member.email === OWNER_EMAIL || ids.has(member.groupId)) continue;
    member.groupId = STAFF_ID;
    changed = true;
  }
  return changed;
}

/** @param {PermStore} store */
function savePermissions(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function newId() {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** @param {string} name */
export function createGroup(name) {
  const store = loadPermissions();
  const group = {
    id: newId(),
    name: String(name || "New group").trim().slice(0, 60) || "New group",
    menus: [],
    tools: [],
  };
  store.groups.push(group);
  savePermissions(store);
  return group;
}

/** @param {string} groupId */
export function deleteGroup(groupId) {
  if (groupId === ADMIN_ID || groupId === STAFF_ID) return false;
  const store = loadPermissions();
  for (const member of store.members) {
    if (member.groupId === groupId && member.email !== OWNER_EMAIL) member.groupId = STAFF_ID;
  }
  store.groups = store.groups.filter((group) => group.id !== groupId);
  savePermissions(store);
  return true;
}

/**
 * @param {string} groupId
 * @param {(group: PermGroup) => void} edit
 */
function updateGroup(groupId, edit) {
  const store = loadPermissions();
  const group = store.groups.find((item) => item.id === groupId);
  if (!group) return;
  edit(group);
  savePermissions(store);
}

/** @param {string} groupId @param {string} name */
export function renameGroup(groupId, name) {
  updateGroup(groupId, (group) => {
    group.name = String(name || "Group").trim().slice(0, 60) || "Group";
  });
}

/**
 * @param {string} groupId
 * @param {"menus" | "tools"} key
 * @param {string} id
 * @param {boolean} on
 */
export function toggleGroupItem(groupId, key, id, on) {
  updateGroup(groupId, (group) => {
    const list = new Set(group[key]);
    if (on) list.add(id);
    else if (!(group.id === ADMIN_ID && key === "menus" && id === "permissions")) list.delete(id);
    if (group.id === ADMIN_ID && key === "menus") list.add("permissions");
    group[key] = [...list];
  });
}

/**
 * @param {string} groupId
 * @param {"menus" | "tools"} key
 * @param {string[]} ids
 * @param {boolean} on
 */
export function toggleGroupItems(groupId, key, ids, on) {
  updateGroup(groupId, (group) => {
    const list = new Set(group[key]);
    for (const id of ids) {
      if (on) list.add(id);
      else if (!(group.id === ADMIN_ID && key === "menus" && id === "permissions")) list.delete(id);
    }
    if (group.id === ADMIN_ID && key === "menus") list.add("permissions");
    group[key] = [...list];
  });
}

/** Emails saved here, plus the signed-in account and other Microsoft accounts cached in this browser. */
function listKnownEmails() {
  /** @type {Set<string>} */
  const found = new Set();
  const add = (value) => {
    const email = String(value || "").trim().toLowerCase();
    if (email.includes("@")) found.add(email);
  };
  add(getEmail());
  for (const member of loadPermissions().members) add(member.email);
  try {
    const saved = JSON.parse(localStorage.getItem(KNOWN_KEY) || "[]");
    if (Array.isArray(saved)) saved.forEach(add);
    for (let i = 0; i < localStorage.length; i += 1) {
      try {
        const raw = localStorage.getItem(localStorage.key(i) || "");
        if (!raw || raw[0] !== "{") continue;
        const parsed = JSON.parse(raw);
        const username = String(parsed?.username || "");
        if (username.toLowerCase().endsWith(`@${AUTH_ALLOWED_DOMAIN}`)) add(username);
      } catch {
        /* ignore one unreadable cache entry */
      }
    }
  } catch {
    /* ignore unreadable cache entries */
  }
  try {
    localStorage.setItem(KNOWN_KEY, JSON.stringify([...found].sort()));
  } catch {
    /* ignore */
  }
  return [...found].sort();
}

const DIRECTORY_SCOPE = ["User.ReadBasic.All"];
const DIRECTORY_CACHE = "dalko.permissions.directory";
const DIRECTORY_TTL = 15 * 60 * 1000;

/**
 * @typedef {{ status: "idle" | "loading" | "ready" | "needs-consent" | "error", people: { email: string, name: string }[], error: string, loadedAt: number }} DirectoryState
 */

/** @type {DirectoryState} */
let directory = { status: "idle", people: [], error: "", loadedAt: 0 };
/** @type {Promise<void> | null} */
let directoryJob = null;
let peopleQuery = "";
let groupsQuery = "";
let peopleScroll = 0;
let groupsScroll = 0;
/** @type {"" | "people" | "groups" | "name"} */
let pageFocus = "";
let pageCaret = 0;

function readDirectoryCache() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(DIRECTORY_CACHE) || "");
    if (!raw || !Array.isArray(raw.people)) return;
    if (Date.now() - Number(raw.loadedAt) > DIRECTORY_TTL) return;
    directory = {
      status: "ready",
      people: raw.people.filter((person) => person && typeof person.email === "string"),
      error: "",
      loadedAt: Number(raw.loadedAt) || 0,
    };
  } catch {
    /* ignore */
  }
}

readDirectoryCache();

/** @param {string} value */
function dalkoEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email.endsWith(`@${AUTH_ALLOWED_DOMAIN}`) || email.includes("#ext#")) return "";
  return email;
}

/** @param {{ mail?: string, userPrincipalName?: string }} user */
function emailFromGraphUser(user) {
  return dalkoEmail(user.mail) || dalkoEmail(user.userPrincipalName);
}

/** @param {string} token */
async function fetchDalkoPeople(token) {
  /** @type {Map<string, { email: string, name: string }>} */
  const people = new Map();
  let url = "https://graph.microsoft.com/v1.0/users?$select=displayName,givenName,surname,mail,userPrincipalName&$top=999";
  for (let page = 0; page < 30 && url; page += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = String(data?.error?.message || `Microsoft Graph returned ${res.status}.`);
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    for (const user of data.value || []) {
      const email = emailFromGraphUser(user);
      if (!email || people.has(email)) continue;
      const given = String(user.givenName || "").trim();
      const surname = String(user.surname || "").trim();
      const named = [given, surname].filter(Boolean).join(" ") || String(user.displayName || "").trim();
      people.set(email, { email, name: named });
    }
    url = String(data["@odata.nextLink"] || "");
  }
  return [...people.values()].sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: "base" })
  );
}

/** @param {boolean} interactive */
async function pullDirectory(interactive) {
  const token = await getAccessToken({ scopes: DIRECTORY_SCOPE, interactive });
  if (!token) {
    if (!getEmail()) {
      directory.status = "needs-consent";
      directory.error = "";
      return;
    }
    directory.status = interactive ? "error" : "needs-consent";
    directory.error = interactive
      ? "Microsoft did not grant directory access. An admin has to approve User.ReadBasic.All on the DALKO Insights app in Entra ID, then try again."
      : "";
    return;
  }
  try {
    const people = await fetchDalkoPeople(token);
    directory = { status: "ready", people, error: "", loadedAt: Date.now() };
    sessionStorage.setItem(DIRECTORY_CACHE, JSON.stringify({ loadedAt: directory.loadedAt, people }));
  } catch (err) {
    const status = /** @type {{ status?: number }} */ (err).status;
    directory.status = "error";
    directory.error =
      status === 403
        ? "An admin has to approve User.ReadBasic.All on the DALKO Insights app in Entra ID before this page can list everyone."
        : err instanceof Error
          ? err.message
          : "Could not load the Dalko directory.";
  }
}

/**
 * Start a directory read when one is still needed.
 * Returns the in-flight job, or null when the page should keep the current list.
 * @param {boolean} [interactive]
 * @returns {Promise<void> | null}
 */
export function loadDalkoDirectory(interactive = false) {
  if (directoryJob) return directoryJob;
  const fresh = directory.status === "ready" && Date.now() - directory.loadedAt < DIRECTORY_TTL;
  if (!interactive && fresh) return null;
  if (!interactive && (directory.status === "needs-consent" || directory.status === "error")) return null;
  directory.status = "loading";
  directory.error = "";
  directoryJob = pullDirectory(interactive).finally(() => {
    directoryJob = null;
  });
  return directoryJob;
}

export function invalidateDalkoDirectory() {
  directory.loadedAt = 0;
  directory.status = "idle";
  directory.error = "";
  try {
    sessionStorage.removeItem(DIRECTORY_CACHE);
  } catch {
    /* ignore */
  }
}

/** People from the company directory, plus anyone already saved on this browser. */
function listRoster() {
  /** @type {Map<string, { email: string, name: string }>} */
  const people = new Map();
  const add = (email, name) => {
    const clean = dalkoEmail(email) || (String(email || "").includes("@") ? String(email).trim().toLowerCase() : "");
    if (!clean) return;
    const label = String(name || "").trim();
    const prev = people.get(clean);
    if (!prev) people.set(clean, { email: clean, name: label });
    else if (!prev.name && label) prev.name = label;
  };
  for (const person of directory.people) add(person.email, person.name);
  for (const email of listKnownEmails()) add(email, "");
  for (const member of loadPermissions().members) add(member.email, "");
  const roster = [...people.values()].sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: "base" })
  );
  placeUnassigned(roster.map((person) => person.email));
  return roster;
}

/**
 * Put a person in one group. The owner always stays in Admin.
 * @param {string} email
 * @param {string} groupId
 * @returns {{ ok: boolean, movedFrom: string }}
 */
export function assignMember(email, groupId) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean || !clean.includes("@") || clean === OWNER_EMAIL) return { ok: false, movedFrom: "" };
  const store = loadPermissions();
  if (!store.groups.some((group) => group.id === groupId)) return { ok: false, movedFrom: "" };
  const previous = store.members.find((member) => member.email === clean);
  if (previous?.groupId === groupId) return { ok: true, movedFrom: "" };
  const fromGroup = previous ? store.groups.find((group) => group.id === previous.groupId) : null;
  store.members = store.members.filter((member) => member.email !== clean);
  store.members.push({ email: clean, groupId });
  store.released = store.released.filter((email) => email !== clean);
  savePermissions(store);
  return { ok: true, movedFrom: fromGroup?.name || "" };
}

/** @param {string} email */
export function removeMember(email) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean || clean === OWNER_EMAIL) return false;
  const store = loadPermissions();
  store.members = store.members.filter((member) => member.email !== clean);
  if (!store.released.includes(clean)) store.released.push(clean);
  savePermissions(store);
  return true;
}

/** People with no group yet start in Everything no FTP. Full access stays a choice. @param {string[]} emails */
function placeUnassigned(emails) {
  const store = loadPermissions();
  const assigned = new Set(store.members.map((member) => member.email));
  const released = new Set(store.released);
  let changed = false;
  for (const email of emails) {
    const clean = dalkoEmail(email);
    if (!clean || clean === OWNER_EMAIL || assigned.has(clean) || released.has(clean)) continue;
    store.members.push({ email: clean, groupId: STAFF_ID });
    assigned.add(clean);
    changed = true;
  }
  if (changed) savePermissions(store);
}

function currentGroup() {
  const email = getEmail();
  if (!email) return null;
  const store = loadPermissions();
  const member = store.members.find((item) => item.email === email);
  if (!member) return null;
  return store.groups.find((group) => group.id === member.groupId) ?? null;
}

/** Assigned people are limited to their group. Everyone else, including the owner, is unrestricted. */
function restrictedGroup() {
  if (getEmail() === OWNER_EMAIL) return null;
  return currentGroup();
}

/** @param {string} view */
export function allowsMenu(view) {
  const group = restrictedGroup();
  if (!group) return true;
  if (view === FTP_MENU) return group.menus.includes(FTP_MENU);
  if (String(view).startsWith("integrations")) return group.menus.includes("integrations");
  return group.menus.includes(view);
}

/** @param {string} pageId Insights inner page id */
export function allowsInsightPage(pageId) {
  const group = restrictedGroup();
  if (!group) return true;
  return group.menus.includes(`insight:${pageId}`);
}

/** @returns {string[]} Insight page ids the current group cannot open. */
export function hiddenInsightPages() {
  if (!restrictedGroup()) return [];
  return INSIGHT_PAGE_IDS.filter((id) => !allowsInsightPage(id));
}

/** @param {string} toolId */
export function allowsTool(toolId) {
  const group = restrictedGroup();
  if (!group) return true;
  return group.tools.includes(toolId);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @typedef {{ kind: "group", id: string } | { kind: "user", email: string }} PermEditor
 * @typedef {{ groupId: string | null, userEmail: string | null, pick: "group" | "user" | null, editor: PermEditor | null }} PermFocus
 */

/** @param {PermFocus} [focus] */
function focusOf(focus) {
  const store = loadPermissions();
  const groupId = store.groups.some((group) => group.id === focus?.groupId) ? focus?.groupId || null : null;
  const userEmail = focus?.userEmail ? String(focus.userEmail).trim().toLowerCase() : null;
  const pick = focus?.pick === "group" || focus?.pick === "user" ? focus.pick : null;
  /** @type {PermEditor | null} */
  let editor = null;
  if (focus?.editor?.kind === "group" && store.groups.some((group) => group.id === focus.editor.id)) {
    editor = { kind: "group", id: focus.editor.id };
  } else if (focus?.editor?.kind === "user" && focus.editor.email) {
    editor = { kind: "user", email: String(focus.editor.email).trim().toLowerCase() };
  }
  return { groupId, userEmail: userEmail || null, pick, editor };
}

function directoryStatusLine() {
  if (directory.status === "loading") return "Loading the Dalko directory…";
  if (directory.status === "needs-consent") {
    if (!getEmail()) return "Sign in, then load the directory to search everyone at Dalko.";
    return "Load the directory to search everyone at Dalko.";
  }
  if (directory.status === "error") return directory.error;
  if (directory.status === "ready") {
    const count = directory.people.length;
    const noun = count === 1 ? "person" : "people";
    return `${count} ${noun}. New people start in Everything no FTP.`;
  }
  return "People saved on this browser are listed below. Load the directory to see everyone at Dalko.";
}

function directoryButton() {
  if (directory.status === "loading") return `<button type="button" disabled>Loading…</button>`;
  if (directory.status === "needs-consent") return `<button type="button" data-perm-directory="consent">Load directory</button>`;
  if (directory.status === "error") return `<button type="button" data-perm-directory="retry">Try again</button>`;
  return `<button type="button" data-perm-directory="refresh">Refresh</button>`;
}

/** @param {PermEditor | null | undefined} editor */
function editorKey(editor) {
  if (!editor) return "";
  return editor.kind === "group" ? `group:${editor.id}` : `user:${editor.email}`;
}

/** Keep scroll and the search box across a redraw of the same screen. @param {PermFocus} [focus] */
function rememberPermUi(focus) {
  const state = focusOf(focus);
  const modal = document.querySelector(".perm-modal");
  const card = document.querySelector(".perm-modal-card");
  const key = editorKey(state.editor);
  if (modal instanceof HTMLElement && card instanceof HTMLElement && key && modal.dataset.permEditor === key) {
    modalScroll = card.scrollTop;
  }
  const groups = document.querySelector('[aria-label="Groups"] .perm-board-scroll');
  const people = document.querySelector(".perm-roster-scroll");
  if (groups instanceof HTMLElement) groupsScroll = groups.scrollTop;
  if (people instanceof HTMLElement) peopleScroll = people.scrollTop;
  if (modalBoxKey) {
    pageFocus = "";
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.matches("[data-perm-find-group]")) {
    pageFocus = "groups";
    pageCaret = active.selectionStart ?? active.value.length;
  } else if (active instanceof HTMLInputElement && active.matches("[data-perm-find]")) {
    pageFocus = "people";
    pageCaret = active.selectionStart ?? active.value.length;
  } else if (active instanceof HTMLInputElement && active.matches("[data-perm-name]")) {
    pageFocus = "name";
    pageCaret = active.selectionStart ?? active.value.length;
  } else pageFocus = "";
}

/** @param {PermFocus} focus */
export function renderPermissionsPage(focus) {
  rememberPermUi(focus);
  const roster = listRoster();
  const state = focusOf(focus);
  const store = loadPermissions();
  const names = new Map(roster.map((person) => [person.email, person.name]));
  const memberGroup = new Map(store.members.map((member) => [member.email, member.groupId]));
  const groupName = new Map(store.groups.map((group) => [group.id, group.name]));
  const pickedUser = state.pick === "user" ? state.userEmail : null;
  const pickedGroup = state.pick === "group" ? state.groupId : null;
  const groupsShown =
    state.pick === "user" ? store.groups.filter((group) => group.id === state.groupId) : store.groups;
  const usersShown =
    state.pick === "group" && state.groupId
      ? roster.filter((person) => memberGroup.get(person.email) === state.groupId)
      : roster;
  const groupRows = groupsShown
    .map((group) => {
      const count = store.members.filter((member) => member.groupId === group.id).length;
      const on = group.id === state.groupId && (state.pick === "group" || state.pick === "user");
      return `
        <tr class="${on ? "is-on" : ""}" data-perm-pick-group="${esc(group.id)}">
          <td class="perm-label" title="${esc(group.name)}">${esc(group.name)}</td>
          <td>${count}</td>
          <td class="perm-row-actions"><button type="button" data-perm-edit-group="${esc(group.id)}">Edit</button></td>
        </tr>`;
    })
    .join("");
  const userRows = usersShown
    .map((person) => {
      const groupId = memberGroup.get(person.email) || "";
      const label = groupId ? groupName.get(groupId) || "Unknown group" : "Full access";
      const named = splitPersonName(person.name);
      const fromMail = nameFromEmail(person.email);
      const first = named.first || fromMail.first;
      const last = named.last || (named.first ? "" : fromMail.last);
      const on = person.email === pickedUser;
      return `
        <tr class="${on ? "is-on" : ""}" data-perm-pick-user="${esc(person.email)}">
          <td class="perm-who">${esc(first)}</td>
          <td class="perm-who">${esc(last)}</td>
          <td class="perm-who perm-mail" title="${esc(person.email)}">${esc(person.email)}</td>
          <td class="perm-group">${esc(label)}</td>
          <td class="perm-row-actions"><button type="button" data-perm-edit-user="${esc(person.email)}">Edit</button></td>
        </tr>`;
    })
    .join("");
  const groupHint =
    state.pick === "user" && !state.groupId
      ? "This person is not in a group."
      : state.pick === "user"
        ? "Click the person again to show every group."
        : "Click a group to list its people.";
  const userHint =
    state.pick === "group" && pickedGroup
      ? `People in ${groupName.get(pickedGroup) || "this group"}. Click the group again to show everyone.`
      : directoryStatusLine();
  const groupBody =
    groupRows ||
    `<tr class="perm-empty-row"><td colspan="3">${state.pick === "user" ? "Full access. Not in a group." : "No groups yet."}</td></tr>`;
  const userBody =
    userRows ||
    `<tr class="perm-empty-row"><td colspan="5">${state.pick === "group" ? "No one is in this group." : "No one to show yet."}</td></tr>`;
  return `
    <div class="page-canvas perm-page">
      <header class="hero">
        <h1>Permissions</h1>
        <p>Click a group to list its people. Click a person to show their group. Edit opens the settings.</p>
      </header>
      <div class="perm-split">
        <section class="perm-card" aria-label="Groups">
          <div class="perm-board-head">
            <div>
              <h2>Groups</h2>
              <p class="perm-hint">${esc(groupHint)}</p>
            </div>
            <button type="button" class="perm-plus" data-perm-new aria-label="Add group" title="Add group">+</button>
          </div>
          <div class="perm-add">
            <input class="perm-find" type="search" data-perm-find-group placeholder="Find a group" value="${esc(groupsQuery)}" autocomplete="off" />
          </div>
          <div class="perm-board-scroll">
            <table class="perm-table perm-board">
              <thead><tr><th>Group</th><th>People</th><th></th></tr></thead>
              <tbody>
                ${groupBody}
                <tr class="perm-empty-row" data-perm-none-groups hidden><td colspan="3">No groups match.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="perm-card" aria-label="Users">
          <div class="perm-board-head">
            <div>
              <h2>Users</h2>
              <p class="perm-hint">${esc(userHint)}</p>
            </div>
            ${directoryButton()}
          </div>
          <div class="perm-add">
            <input class="perm-find" type="search" data-perm-find placeholder="Find a person" value="${esc(peopleQuery)}" autocomplete="off" />
          </div>
          <div class="perm-board-scroll perm-roster-scroll">
            <table class="perm-table perm-board perm-users">
              <thead><tr><th>First name</th><th>Last name</th><th>Email</th><th>Group</th><th></th></tr></thead>
              <tbody>
                ${userBody}
                <tr class="perm-empty-row" data-perm-none hidden><td colspan="5">No one matches.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
      ${renderEditor(store, state, names)}
    </div>`;
}

/**
 * @param {PermStore} store
 * @param {PermFocus} state
 * @param {Map<string, string>} names
 */
function renderEditor(store, state, names) {
  if (!state.editor) return "";
  if (state.editor.kind === "group") {
    const group = store.groups.find((item) => item.id === state.editor.id);
    if (!group) return "";
    const isAdmin = group.id === ADMIN_ID;
    const isStaff = group.id === STAFF_ID;
    const tree = permissionTree().map((node) => renderTreeNode(node)).join("");
    const hint = isAdmin
      ? "Admin can always open Permissions."
      : isStaff
        ? "Everyone starts here. FTP stays off unless you turn it on."
        : "Check what this group can open.";
    const deleteTitle = isAdmin
      ? "Admin stays so Permissions can always be opened"
      : isStaff
        ? "This group stays. People start here."
        : "Delete this group. Its people move to Everything no FTP.";
    return `
      <div class="perm-modal" data-perm-editor="group:${esc(group.id)}" role="dialog" aria-modal="true" aria-label="${esc(group.name)}">
        <div class="perm-modal-backdrop" data-perm-close></div>
        <div class="perm-modal-card">
          <div class="perm-editor-head">
            <input class="perm-name" data-perm-name value="${esc(group.name)}" aria-label="Group name" maxlength="60" autocomplete="off" spellcheck="false" />
            <button type="button" data-perm-close>Close</button>
          </div>
          <p class="perm-hint">${hint}</p>
          <div class="perm-tree-wrap"><ul class="perm-tree">${tree}</ul></div>
          <div class="perm-user-actions">
            <button type="button" data-perm-delete="${esc(group.id)}" ${isAdmin || isStaff ? "disabled" : ""} title="${deleteTitle}">Delete group</button>
          </div>
        </div>
      </div>`;
  }
  const email = state.editor.email;
  const personName = names.get(email) || "";
  const member = store.members.find((item) => item.email === email);
  const locked = email === OWNER_EMAIL;
  const options = [`<option value=""${!member ? " selected" : ""}>Full access</option>`]
    .concat(
      store.groups.map(
        (group) =>
          `<option value="${esc(group.id)}"${group.id === member?.groupId ? " selected" : ""}>${esc(group.name)}</option>`
      )
    )
    .join("");
  return `
    <div class="perm-modal" data-perm-editor="user:${esc(email)}" role="dialog" aria-modal="true" aria-label="${esc(personName || email)}">
      <div class="perm-modal-backdrop" data-perm-close></div>
      <div class="perm-modal-card">
        <div class="perm-editor-head">
          <h2>${esc(personName || email)}</h2>
          <button type="button" data-perm-close>Close</button>
        </div>
        ${personName ? `<p class="perm-hint">${esc(email)}</p>` : ""}
        <label class="perm-field">Group
          <select data-perm-assign="${esc(email)}" aria-label="Group" ${locked ? "disabled" : ""}>${options}</select>
        </label>
        <p class="perm-hint">${locked ? "This account stays in Admin." : "Full access can still open everything."}</p>
      </div>
    </div>`;
}

/** @param {PermNode} node */
function renderTreeNode(node) {
  const grant = grantsOf(node);
  const children = (node.children || []).map((child) => renderTreeNode(child)).join("");
  const lockPermissions = grant.menus.length === 1 && grant.menus[0] === "permissions" && grant.tools.length === 0;
  return `
    <li>
      <label class="perm-node">
        <input type="checkbox" data-perm-box data-menus="${esc(grant.menus.join(","))}" data-tools="${esc(grant.tools.join(","))}" ${lockPermissions ? "data-perm-lock" : ""} />
        <span>${esc(node.label)}</span>
      </label>
      ${children ? `<ul>${children}</ul>` : ""}
    </li>`;
}

/** @param {string} email */
function nameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const cap = (part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "");
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: cap(parts[0]), last: "" };
  return { first: cap(parts[0]), last: parts.slice(1).map(cap).join(" ") };
}

/** @param {string} name */
function splitPersonName(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  if (!clean) return { first: "", last: "" };
  const comma = clean.indexOf(",");
  if (comma > 0) return { last: clean.slice(0, comma).trim(), first: clean.slice(comma + 1).trim() };
  const space = clean.indexOf(" ");
  if (space < 0) return { first: clean, last: "" };
  return { first: clean.slice(0, space), last: clean.slice(space + 1).trim() };
}

/** @param {HTMLElement} root */
function applyPeopleFilter(root) {
  const needle = peopleQuery.trim().toLowerCase();
  let shown = 0;
  root.querySelectorAll("[data-perm-pick-user]").forEach((row) => {
    const who = [...row.querySelectorAll(".perm-who, .perm-group")].map((cell) => cell.textContent || "").join(" ");
    const hit = !needle || who.toLowerCase().includes(needle);
    if (row instanceof HTMLElement) row.hidden = !hit;
    if (hit) shown += 1;
  });
  const empty = root.querySelector("[data-perm-none]");
  if (empty instanceof HTMLElement) empty.hidden = !needle || shown > 0;
}

/**
 * Show a renamed group in the table without rebuilding the popup.
 * @param {HTMLElement} root
 * @param {string} groupId
 * @param {string} label
 * @param {string | null} pickedGroupId
 */
function syncGroupLabel(root, groupId, label, pickedGroupId) {
  const row = root.querySelector(`[data-perm-pick-group="${CSS.escape(groupId)}"]`);
  const cell = row?.querySelector("td");
  if (cell) cell.textContent = label;
  const dialog = root.querySelector(".perm-modal");
  if (dialog instanceof HTMLElement) dialog.setAttribute("aria-label", label);
  if (pickedGroupId === groupId) {
    const hint = root.querySelector('[aria-label="Users"] .perm-hint');
    if (hint) hint.textContent = `People in ${label}. Click the group again to show everyone.`;
  }
  applyGroupsFilter(root);
}

/** @param {HTMLElement} root */
function applyGroupsFilter(root) {
  const needle = groupsQuery.trim().toLowerCase();
  let shown = 0;
  root.querySelectorAll("[data-perm-pick-group]").forEach((row) => {
    const name = row.querySelector("td")?.textContent || "";
    const hit = !needle || name.toLowerCase().includes(needle);
    if (row instanceof HTMLElement) row.hidden = !hit;
    if (hit) shown += 1;
  });
  const empty = root.querySelector("[data-perm-none-groups]");
  if (empty instanceof HTMLElement) empty.hidden = !needle || shown > 0;
}

/** @type {((event: KeyboardEvent) => void) | null} */
let permKeyHandler = null;
let modalScroll = 0;
let modalBoxKey = "";

/**
 * @param {HTMLElement} root
 * @param {{ focus: PermFocus, onFocus: (focus: PermFocus) => void }} opts
 */
export function bindPermissionsPage(root, opts) {
  const focus = focusOf(opts.focus);
  const store = loadPermissions();
  const editing = focus.editor?.kind === "group" ? store.groups.find((group) => group.id === focus.editor.id) : null;
  const scroller = root.querySelector(".perm-roster-scroll");
  const go = (/** @type {Partial<PermFocus>} */ next) => {
    const editor = next.editor === undefined ? focus.editor : next.editor;
    const same =
      !!editor &&
      !!focus.editor &&
      editor.kind === focus.editor.kind &&
      (editor.kind === "group"
        ? editor.id === (focus.editor.kind === "group" ? focus.editor.id : "")
        : editor.email === (focus.editor.kind === "user" ? focus.editor.email : ""));
    const card = root.querySelector(".perm-modal-card");
    if (same && card instanceof HTMLElement) modalScroll = card.scrollTop;
    else modalScroll = 0;
    if (!same) modalBoxKey = "";
    if (scroller instanceof HTMLElement) peopleScroll = scroller.scrollTop;
    opts.onFocus(focusOf({ ...focus, ...next }));
  };

  root.querySelectorAll("[data-perm-box]").forEach((box) => {
    if (!(box instanceof HTMLInputElement) || !editing) return;
    const menus = String(box.dataset.menus || "").split(",").filter(Boolean);
    const tools = String(box.dataset.tools || "").split(",").filter(Boolean);
    const ownedMenus = new Set(editing.menus);
    const ownedTools = new Set(editing.tools);
    const on = menus.filter((id) => ownedMenus.has(id)).length + tools.filter((id) => ownedTools.has(id)).length;
    const total = menus.length + tools.length;
    const locked = editing.id === ADMIN_ID && box.hasAttribute("data-perm-lock");
    box.checked = locked || (total > 0 && on === total);
    box.indeterminate = !locked && on > 0 && on < total;
    box.disabled = locked;
  });

  applyPeopleFilter(root);
  applyGroupsFilter(root);
  if (scroller instanceof HTMLElement) scroller.scrollTop = peopleScroll;
  const groupScroller = root.querySelector('[aria-label="Groups"] .perm-board-scroll');
  if (groupScroller instanceof HTMLElement) groupScroller.scrollTop = groupsScroll;
  const card = root.querySelector(".perm-modal-card");
  if (card instanceof HTMLElement) card.scrollTop = modalScroll;
  if (modalBoxKey) {
    const boxKey = modalBoxKey;
    modalBoxKey = "";
    const match = [...root.querySelectorAll("[data-perm-box]")].find(
      (el) => el instanceof HTMLInputElement && `${el.dataset.menus}|${el.dataset.tools}` === boxKey
    );
    if (match instanceof HTMLElement) match.focus({ preventScroll: true });
    if (card instanceof HTMLElement) card.scrollTop = modalScroll;
  } else if (pageFocus === "name") {
    const input = root.querySelector("[data-perm-name]");
    pageFocus = "";
    if (input instanceof HTMLInputElement) {
      input.focus({ preventScroll: true });
      const pos = Math.min(pageCaret, input.value.length);
      try {
        input.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
      if (card instanceof HTMLElement) card.scrollTop = modalScroll;
    }
  } else if (pageFocus) {
    const input = root.querySelector(pageFocus === "groups" ? "[data-perm-find-group]" : "[data-perm-find]");
    pageFocus = "";
    if (input instanceof HTMLInputElement) {
      input.focus({ preventScroll: true });
      const pos = Math.min(pageCaret, input.value.length);
      input.setSelectionRange(pos, pos);
    }
  }

  if (permKeyHandler) {
    document.removeEventListener("keydown", permKeyHandler);
    permKeyHandler = null;
  }
  if (focus.editor) {
    permKeyHandler = (event) => {
      if (event.key !== "Escape") return;
      if (!document.querySelector(".perm-modal")) return;
      event.preventDefault();
      go({ editor: null });
    };
    document.addEventListener("keydown", permKeyHandler);
  }

  const find = root.querySelector("[data-perm-find]");
  find?.addEventListener("input", () => {
    if (!(find instanceof HTMLInputElement)) return;
    peopleQuery = find.value;
    applyPeopleFilter(root);
  });
  const findGroup = root.querySelector("[data-perm-find-group]");
  findGroup?.addEventListener("input", () => {
    if (!(findGroup instanceof HTMLInputElement)) return;
    groupsQuery = findGroup.value;
    applyGroupsFilter(root);
  });
  root.querySelectorAll("[data-perm-close]").forEach((el) => {
    el.addEventListener("click", () => go({ editor: null }));
  });
  root.querySelector("[data-perm-new]")?.addEventListener("click", () => {
    const group = createGroup("New group");
    go({ groupId: group.id, userEmail: null, pick: "group", editor: { kind: "group", id: group.id } });
  });
  root.querySelectorAll("[data-perm-pick-group]").forEach((row) => {
    row.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (row).dataset.permPickGroup || "";
      if (!id) return;
      if (focus.pick === "group" && focus.groupId === id) go({ groupId: null, userEmail: null, pick: null, editor: null });
      else go({ groupId: id, userEmail: null, pick: "group", editor: null });
    });
  });
  root.querySelectorAll("[data-perm-pick-user]").forEach((row) => {
    row.addEventListener("click", () => {
      const email = /** @type {HTMLElement} */ (row).dataset.permPickUser || "";
      if (!email) return;
      if (focus.pick === "user" && focus.userEmail === email) go({ groupId: null, userEmail: null, pick: null, editor: null });
      else {
        const groupId = store.members.find((member) => member.email === email)?.groupId || null;
        go({ groupId, userEmail: email, pick: "user", editor: null });
      }
    });
  });
  root.querySelectorAll("[data-perm-edit-group]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = /** @type {HTMLElement} */ (btn).dataset.permEditGroup || "";
      if (!id) return;
      go({ groupId: id, userEmail: null, pick: "group", editor: { kind: "group", id } });
    });
  });
  root.querySelectorAll("[data-perm-edit-user]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const email = /** @type {HTMLElement} */ (btn).dataset.permEditUser || "";
      if (!email) return;
      const groupId = store.members.find((member) => member.email === email)?.groupId || null;
      go({ groupId, userEmail: email, pick: "user", editor: { kind: "user", email } });
    });
  });
  const name = root.querySelector("[data-perm-name]");
  const commitName = (/** @type {boolean} */ fallback) => {
    if (!(name instanceof HTMLInputElement) || !editing) return;
    const trimmed = name.value.trim().slice(0, 60) || (fallback ? "Group" : "");
    if (!trimmed) return;
    if (fallback && name.value !== trimmed) name.value = trimmed;
    if (trimmed === editing.name) return;
    renameGroup(editing.id, trimmed);
    editing.name = trimmed;
    syncGroupLabel(root, editing.id, trimmed, focus.groupId);
  };
  name?.addEventListener("input", () => commitName(false));
  name?.addEventListener("change", () => commitName(true));
  root.querySelector("[data-perm-delete]")?.addEventListener("click", () => {
    const btn = root.querySelector("[data-perm-delete]");
    if (!(btn instanceof HTMLButtonElement) || btn.disabled || !editing) return;
    if (!deleteGroup(editing.id)) return;
    go({ groupId: null, userEmail: null, pick: null, editor: null });
  });
  root.querySelectorAll("[data-perm-box]").forEach((box) => {
    box.addEventListener("change", () => {
      if (!(box instanceof HTMLInputElement) || box.disabled || !editing) return;
      const menus = String(box.dataset.menus || "").split(",").filter(Boolean);
      const tools = String(box.dataset.tools || "").split(",").filter(Boolean);
      const menuIds = box.checked ? [...new Set([...menus, ...ancestorMenusFor(menus, tools)])] : menus;
      toggleGroupItems(editing.id, "menus", menuIds, box.checked);
      toggleGroupItems(editing.id, "tools", tools, box.checked);
      modalBoxKey = `${box.dataset.menus}|${box.dataset.tools}`;
      go({ editor: { kind: "group", id: editing.id }, pick: "group", groupId: editing.id, userEmail: null });
    });
  });
  root.querySelector("[data-perm-assign]")?.addEventListener("change", () => {
    const select = root.querySelector("[data-perm-assign]");
    if (!(select instanceof HTMLSelectElement) || select.disabled || focus.editor?.kind !== "user") return;
    const email = focus.editor.email;
    const groupId = select.value;
    if (scroller instanceof HTMLElement) peopleScroll = scroller.scrollTop;
    if (groupId) assignMember(email, groupId);
    else removeMember(email);
    go({
      groupId: groupId || null,
      userEmail: email,
      pick: "user",
      editor: { kind: "user", email },
    });
  });
  root.querySelector("[data-perm-directory]")?.addEventListener("click", () => {
    const mode = /** @type {HTMLElement} */ (root.querySelector("[data-perm-directory]")).dataset.permDirectory;
    if (mode === "refresh") invalidateDalkoDirectory();
    loadDalkoDirectory(mode === "consent" || mode === "retry");
    go(focus);
  });
}
