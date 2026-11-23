/**
 * Permission groups. A group owns menu items and tools. A person belongs to one group.
 * Anyone left on Full access keeps every page, including FTP.
 * New people start in Everything no FTP. Admin always includes the owner and can always open Permissions.
 */

import { NAV_ITEMS as INSIGHT_NAV } from "../../portals/dalko/js/ui/nav.js?v=20260923-desk";
import { CLIENT_REPORT_BANDS, SECTIONS } from "../../portals/glassbox/js/catalog.js?v=20261023-ttx";
import { AUTH_ALLOWED_DOMAIN } from "./auth-config.js?v=20260915-app3";
import { getAccessToken, getAccount, getEmail, getRackToken } from "./auth.js?v=20261023-id";
import { confirmDialog } from "./dialog.js?v=20261006-nobrand";
import { RACK_ORIGIN } from "./ftp-rack.js?v=20261023-id";

const STORAGE_KEY = "dalko.permissions.v1";
const KNOWN_KEY = "dalko.permissions.known";
const ADMIN_ID = "admin";
const STAFF_ID = "everything-no-ftp";
const FTP_MENU = "integrations-ftp";
const OWNER_EMAIL = "terry.stowe@shipdalko.com";

/** @typedef {{ id: string, name: string, menus: string[], tools: string[], actions: string[] }} PermGroup */
/** @typedef {{ email: string, groupId: string, menus: string[], tools: string[], actions: string[] }} PermMember */
/** @typedef {{ groups: PermGroup[], members: PermMember[], released: string[] }} PermStore */

const INSIGHT_PAGE_IDS = INSIGHT_NAV.filter((item) => item.id !== "changelog").map((item) => item.id);

const TOOL_SHORTCUTS = [
  { label: "Carrier Search", menu: "carrier-search", tool: "Carrier Search" },
  { label: "Zip Calculator", menu: "zip-calculator", tool: "Zip Calculator" },
  { label: "Currency Converter", menu: "currency-converter", tool: "Currency Converter" },
];
const SIDEBAR_TOOL_IDS = new Set(TOOL_SHORTCUTS.map((item) => item.tool));

/**
 * @typedef {{ label: string, menus?: string[], tools?: string[], actions?: string[], children?: PermNode[] }} PermNode
 */

/** @typedef {{ id: string, label: string }} PageButton */

const SEND_TOOLS = new Set(["Phinia Shipment Upload", "Demo Upload", "DATs Weekly Upload"]);
const EXPORT_TOOLS = new Set(["Value Standardizer", "Carrier Performance", "Batch Mapper"]);
const DELETE_TOOLS = new Set(["Excel Trimmer"]);
const CLEAR_ONLY = new Set([
  "Zip Calculator",
  "Currency Converter",
  "Maddox Carrier Email",
  "A. Stucki Carrier Email",
]);
const LOOKUP_TOOLS = new Set(["Carrier Search"]);
const CALCULATE_TOOLS = new Set(["NMFC Calculator"]);

/** @type {Record<string, PageButton[]>} */
const INSIGHT_BUTTONS = {
  home: [
    { id: "insights:upload", label: "Upload TMS" },
    { id: "insights:clear-data", label: "Clear data" },
  ],
  dashboard: [
    { id: "insights:export", label: "Export Report" },
    { id: "insights:print", label: "Print / PDF" },
  ],
  filters: [
    { id: "insights:clear-focus", label: "Clear focus" },
    { id: "insights:delete-focus", label: "Delete focus" },
  ],
};

const PERMISSION_BUTTONS = [
  { id: "permissions:add-group", label: "Add group" },
  { id: "permissions:delete-group", label: "Delete group" },
];

/** @param {string} toolId @param {string} key @param {string} label @returns {PageButton} */
function toolButton(toolId, key, label) {
  return { id: `btn:${toolId}:${key}`, label };
}

/** Buttons that actually sit on this tool's page. @param {{ id: string, script?: string }} tool @returns {PageButton[]} */
function buttonsForTool(tool) {
  const id = tool.id;
  if (LOOKUP_TOOLS.has(id)) return [toolButton(id, "lookup", "Look up")];
  if (CALCULATE_TOOLS.has(id)) return [toolButton(id, "calculate", "Calculate"), toolButton(id, "clear", "Clear")];
  /** @type {PageButton[]} */
  const buttons = [];
  const upload = String(tool.script || "").startsWith("Client Uploads/");
  if (!CLEAR_ONLY.has(id) && id !== "Batch Mapper") buttons.push(toolButton(id, "run", upload ? "Run and save" : "Run"));
  if (SEND_TOOLS.has(id)) buttons.push(toolButton(id, "send", "Run and send"));
  if (!LOOKUP_TOOLS.has(id)) buttons.push(toolButton(id, "clear", "Clear"));
  if (EXPORT_TOOLS.has(id)) buttons.push(toolButton(id, "export", "Export"));
  if (DELETE_TOOLS.has(id)) buttons.push(toolButton(id, "delete", "Delete"));
  return buttons;
}

/** @param {PageButton[]} buttons @returns {PermNode[]} */
function buttonNodes(buttons) {
  return buttons.map((button) => ({ label: button.label, actions: [button.id] }));
}

/** @param {PermNode} node @param {PageButton[]} buttons @returns {PermNode} */
function withButtons(node, buttons) {
  const children = buttonNodes(buttons);
  if (!children.length) return node;
  return { ...node, children: [...(node.children || []), ...children] };
}

/** The sidebar, then the pages and tools that live under each section. */
function permissionTree() {
  return [
    { label: "Today", menus: ["home"] },
    {
      label: "Reports",
      menus: ["client-reports"],
      children: [
        ...CLIENT_REPORT_BANDS.map((band) => ({
          label: band.label,
          children: band.tools.map((tool) => withButtons({ label: tool.label, tools: [tool.id] }, buttonsForTool(tool))),
        })),
      ],
    },
    {
      label: "Client Uploads",
      menus: ["client-uploads"],
      children: [
        ...(SECTIONS.find((section) => section.id === "client-uploads")?.tools || []).map((tool) =>
          withButtons({ label: tool.label, tools: [tool.id] }, buttonsForTool(tool))
        ),
      ],
    },
    {
      label: "Carrier Pricing",
      menus: ["carrier-pricing"],
      children: [
        { label: "Add record", actions: ["carrier-pricing:add"] },
        { label: "Edit record", actions: ["carrier-pricing:edit"] },
        { label: "Export CSV", actions: ["carrier-pricing:export"] },
        { label: "Email record", actions: ["carrier-pricing:email"] },
        { label: "Delete record", actions: ["carrier-pricing:delete"] },
      ],
    },
    {
      label: "Data Dump Analyzer",
      menus: ["insights"],
      children: [
        ...INSIGHT_NAV.filter((item) => item.id !== "changelog").map((item) =>
          withButtons({ label: item.label, menus: [`insight:${item.id}`] }, INSIGHT_BUTTONS[item.id] || [])
        ),
      ],
    },
    {
      label: "Tools",
      children: [
        ...TOOL_SHORTCUTS.map((item) =>
          withButtons(
            { label: item.label, menus: [item.menu], tools: [item.tool] },
            buttonsForTool({ id: item.tool, script: "" })
          )
        ),
        ...SECTIONS.filter((section) => section.id !== "client-uploads").map((section) => ({
          label: section.label,
          menus: [section.id],
          children: section.tools
            .filter((tool) => !SIDEBAR_TOOL_IDS.has(tool.id))
            .map((tool) => withButtons({ label: tool.label, tools: [tool.id] }, buttonsForTool(tool))),
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
          children: [
            { label: "File transfer", menus: [FTP_MENU] },
            { label: "CRM switch", tools: ["crm-switch"] },
            { label: "FTP switch", tools: ["ftp-switch"] },
          ],
        },
        withButtons({ label: "Permissions", menus: ["permissions"] }, PERMISSION_BUTTONS),
        { label: "Themes", menus: ["themes"] },
      ],
    },
  ];
}

/** @param {PermNode} node */
function grantsOf(node) {
  const menus = [...(node.menus || [])];
  const tools = [...(node.tools || [])];
  const actions = [...(node.actions || [])];
  for (const child of node.children || []) {
    const sub = grantsOf(child);
    menus.push(...sub.menus);
    tools.push(...sub.tools);
    actions.push(...sub.actions);
  }
  return { menus, tools, actions };
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
  /** @type {Set<string>} */
  const actions = new Set();
  /** @param {PermNode} node */
  const walk = (node) => {
    for (const id of node.menus || []) if (!skipMenus.has(id)) menus.add(id);
    for (const id of node.tools || []) tools.add(id);
    for (const id of node.actions || []) actions.add(id);
    for (const child of node.children || []) walk(child);
  };
  for (const node of permissionTree()) walk(node);
  return { menus: [...menus], tools: [...tools], actions: [...actions] };
}

/** Menus required to open the page that holds a grant. @param {string[]} menus @param {string[]} tools @param {string[]} [actions] */
function ancestorMenusFor(menus, tools, actions = []) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  /** @param {PermNode} node @param {string[]} ancestors */
  const walk = (node, ancestors) => {
    for (const id of node.menus || []) map.set(`m:${id}`, ancestors);
    for (const id of node.tools || []) map.set(`t:${id}`, ancestors);
    for (const id of node.actions || []) map.set(`a:${id}`, ancestors);
    const next = ancestors.concat(node.menus || []);
    for (const child of node.children || []) walk(child, next);
  };
  for (const node of permissionTree()) walk(node, []);
  const extra = new Set();
  for (const id of menus) for (const parent of map.get(`m:${id}`) || []) extra.add(parent);
  for (const id of tools) for (const parent of map.get(`t:${id}`) || []) extra.add(parent);
  for (const id of actions) for (const parent of map.get(`a:${id}`) || []) extra.add(parent);
  return [...extra];
}

/** @param {PermStore} store */
function ensureAdmin(store) {
  let changed = false;
  let admin = store.groups.find((group) => group.id === ADMIN_ID);
  if (!admin) {
    admin = {
      id: ADMIN_ID,
      name: "Admin",
      menus: ["permissions"],
      tools: [],
      actions: PERMISSION_BUTTONS.map((item) => item.id),
    };
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
    store.members.push({ email: OWNER_EMAIL, groupId: ADMIN_ID, menus: [], tools: [], actions: [] });
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
    staff = {
      id: STAFF_ID,
      name: "Everything no FTP",
      menus: grants.menus,
      tools: grants.tools.filter((tool) => tool !== "crm-switch" && tool !== "ftp-switch"),
      actions: grants.actions.filter((id) => !id.endsWith(":send")),
    };
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

function catalogTools() {
  return [...CLIENT_REPORT_BANDS.flatMap((band) => band.tools), ...SECTIONS.flatMap((section) => section.tools)];
}

/** @param {{ id: string, script?: string }} tool @param {PermGroup} group */
function toolPageOn(tool, group) {
  if ((group.tools || []).includes(tool.id)) return true;
  const script = String(tool.script || "");
  if (script.startsWith("Client Reports/") && group.menus.includes("client-reports")) return true;
  if (script.startsWith("Client Uploads/") && group.menus.includes("client-uploads")) return true;
  const section = SECTIONS.find((item) => item.tools.some((entry) => entry.id === tool.id));
  if (section && group.menus.includes(section.id)) return true;
  const shortcut = TOOL_SHORTCUTS.find((item) => item.tool === tool.id);
  return Boolean(shortcut && group.menus.includes(shortcut.menu));
}

/** Buttons that belong with the pages this group already has. @param {PermGroup} group */
function defaultActionsFor(group) {
  const actions = new Set();
  const menus = new Set(group.menus || []);
  const wholeAnalyzer = menus.has("insights");
  for (const [pageId, buttons] of Object.entries(INSIGHT_BUTTONS)) {
    if (wholeAnalyzer || menus.has(`insight:${pageId}`)) {
      for (const button of buttons) actions.add(button.id);
    }
  }
  for (const tool of catalogTools()) {
    if (!toolPageOn(tool, group)) continue;
    for (const button of buttonsForTool(tool)) {
      if (group.id === STAFF_ID && button.id.endsWith(":send")) continue;
      actions.add(button.id);
    }
  }
  if (menus.has("permissions")) {
    for (const button of PERMISSION_BUTTONS) actions.add(button.id);
  }
  if (menus.has("carrier-pricing")) {
    actions.add("carrier-pricing:add");
    actions.add("carrier-pricing:edit");
    actions.add("carrier-pricing:export");
    actions.add("carrier-pricing:email");
    actions.add("carrier-pricing:delete");
  }
  return [...actions];
}

/** Older section-wide button grants become the same button on each page. @param {string[]} actions */
function expandLegacyActions(actions) {
  const reports = CLIENT_REPORT_BANDS.flatMap((band) => band.tools);
  const uploads = SECTIONS.find((section) => section.id === "client-uploads")?.tools || [];
  const reportIds = new Set(reports.map((tool) => tool.id));
  const uploadIds = new Set(uploads.map((tool) => tool.id));
  const others = catalogTools().filter((tool) => !reportIds.has(tool.id) && !uploadIds.has(tool.id));
  const next = new Set();
  const addKey = (tools, key) => {
    for (const tool of tools) {
      const match = buttonsForTool(tool).find((button) => button.id.endsWith(`:${key}`));
      if (match) next.add(match.id);
    }
  };
  for (const id of actions) {
    if (id === "reports:run") addKey(reports, "run");
    else if (id === "reports:clear") addKey(reports, "clear");
    else if (id === "uploads:run") addKey(uploads, "run");
    else if (id === "uploads:clear") addKey(uploads, "clear");
    else if (id === "uploads:send") addKey(uploads, "send");
    else if (id === "tools:run") addKey(others, "run");
    else if (id === "tools:clear") addKey(others, "clear");
    else if (id === "tools:export") addKey(others, "export");
    else if (id === "tools:delete") addKey(others, "delete");
    else next.add(id);
  }
  return [...next];
}

/** @returns {PermStore} */
function normalizeStore(data) {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const members = Array.isArray(data?.members) ? data.members : [];
  return {
    groups: groups
      .filter((group) => group && typeof group.id === "string")
      .map((group) => {
        const menus = Array.isArray(group.menus) ? group.menus.map(String) : [];
        const tools = Array.isArray(group.tools) ? group.tools.map(String) : [];
        const hadActions = Array.isArray(group.actions);
        /** @type {PermGroup} */
        const next = {
          id: group.id,
          name: String(group.name || "Group").slice(0, 60),
          menus,
          tools,
          actions: hadActions ? group.actions.map(String) : [],
        };
        next.actions = hadActions ? expandLegacyActions(next.actions) : defaultActionsFor(next);
        return next;
      }),
    members: [...members.reduce((map, member) => {
      if (!member || typeof member.email !== "string" || typeof member.groupId !== "string") return map;
      const email = member.email.trim().toLowerCase();
      if (!email.includes("@")) return map;
      const menus = Array.isArray(member.menus) ? member.menus.map(String) : [];
      const tools = Array.isArray(member.tools) ? member.tools.map(String) : [];
      const hadActions = Array.isArray(member.actions);
      const actions = hadActions
        ? expandLegacyActions(member.actions.map(String))
        : defaultActionsFor({ id: "", name: "", menus, tools, actions: [] });
      map.set(email, { groupId: member.groupId, menus, tools, actions });
      return map;
    }, new Map())].map(([email, item]) => ({
      email,
      groupId: item.groupId,
      menus: item.menus,
      tools: item.tools,
      actions: item.actions,
    })),
    released: [...new Set(
      (Array.isArray(data?.released) ? data.released : [])
        .map((email) => String(email || "").trim().toLowerCase())
        .filter((email) => email.includes("@"))
    )],
  };
}

function cloneStore(store) {
  return normalizeStore(JSON.parse(JSON.stringify(store)));
}

/** @type {PermStore | null} */
let memory = null;
let hydrated = false;
let remoteNote = "";
let pushChain = Promise.resolve();
let pushGen = 0;

/** @param {PermStore} store */
function viewerCanWrite(store) {
  const email = String(getEmail() || "").trim().toLowerCase();
  if (!email) return false;
  if (email === OWNER_EMAIL) return true;
  return store.members.some((member) => member.email === email && member.groupId === ADMIN_ID);
}

function paintRemoteNote() {
  const note = document.getElementById("perm-remote-note");
  if (!(note instanceof HTMLElement)) return;
  note.hidden = !remoteNote;
  note.textContent = remoteNote;
}

/** @returns {PermStore} */
function readLocalStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

function localStoreIsCustom(store) {
  if (store.released.length > 0) return true;
  if (store.groups.some((group) => group.id !== ADMIN_ID && group.id !== STAFF_ID)) return true;
  if (store.members.some((member) => member.email !== OWNER_EMAIL)) return true;
  return false;
}

async function rackToken() {
  await getAccessToken({ interactive: false });
  if (!getRackToken() && getAccount()) await getAccessToken({ interactive: true });
  return getRackToken();
}

function rackLoadError(status, data) {
  if (status === 401) return "Microsoft did not confirm this sign-in. Sign out and sign in again.";
  if (status === 403) return String(data?.error || "This account cannot load permissions.");
  return String(data?.error || "DELTA did not answer. Changes on this page are not saved.");
}

/** @param {PermStore} store */
async function pushStore(store) {
  const token = await rackToken();
  if (!token) {
    remoteNote = "Sign in again to save permissions.";
    paintRemoteNote();
    return;
  }
  try {
    const res = await fetch(`${RACK_ORIGIN}/api/permissions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ store }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.store) {
      remoteNote = res.status === 403
        ? "Only an Admin can save permissions."
        : "DELTA did not save this change.";
      paintRemoteNote();
      return;
    }
    memory = normalizeStore(data.store);
    remoteNote = "";
    paintRemoteNote();
  } catch {
    remoteNote = "DELTA did not answer. Changes on this page are not saved.";
    paintRemoteNote();
  }
}

/** @param {PermStore} store */
function savePermissions(store) {
  if (!hydrated) return;
  if (!viewerCanWrite(store)) return;
  memory = cloneStore(store);
  const gen = ++pushGen;
  const snapshot = cloneStore(store);
  pushChain = pushChain
    .then(async () => {
      if (gen !== pushGen) return;
      await pushStore(snapshot);
    })
    .catch(() => {});
}

/** Load the shared permissions from DELTA. */
export async function pullPermissions() {
  const token = await rackToken();
  if (!token) {
    hydrated = false;
    remoteNote = getAccount()
      ? "Microsoft did not confirm this sign-in. Sign out and sign in again."
      : "Sign in to load permissions from DELTA.";
    return;
  }
  try {
    const res = await fetch(`${RACK_ORIGIN}/api/permissions`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.store) {
      hydrated = false;
      remoteNote = rackLoadError(res.status, data);
      return;
    }
    hydrated = true;
    remoteNote = "";
    memory = normalizeStore(data.store);
    if (Number(data.revision) === 0 && viewerCanWrite(memory)) {
      const local = readLocalStore();
      if (localStoreIsCustom(local)) memory = local;
    }
    loadPermissions();
  } catch {
    hydrated = false;
    remoteNote = "The browser could not reach DELTA. Changes on this page are not saved.";
  }
}

export function resetPermissions() {
  memory = null;
  hydrated = false;
  remoteNote = "";
  pushGen += 1;
}

/** @returns {PermStore} */
function readPermissions() {
  if (!memory) return emptyStore();
  return cloneStore(memory);
}

/** @returns {PermStore} */
export function loadPermissions() {
  const store = readPermissions();
  const adminChanged = ensureAdmin(store);
  const staffChanged = ensureStaff(store);
  const repaired = repairMembers(store);
  const parents = repairGrantParents(store);
  if (adminChanged || staffChanged || repaired || parents) {
    if (!hydrated) return store;
    if (viewerCanWrite(store)) savePermissions(store);
    else memory = cloneStore(store);
  }
  return store;
}

/** A checked page or tool also keeps the menu that opens it. @param {PermStore} store */
function repairGrantParents(store) {
  let changed = false;
  for (const group of store.groups) {
    for (const id of ancestorMenusFor(group.menus, group.tools, group.actions)) {
      if (group.menus.includes(id)) continue;
      group.menus.push(id);
      changed = true;
    }
  }
  for (const member of store.members) {
    const group = store.groups.find((item) => item.id === member.groupId);
    for (const id of ancestorMenusFor(member.menus, member.tools, member.actions)) {
      if (member.menus.includes(id) || group?.menus.includes(id)) continue;
      member.menus.push(id);
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
    actions: [],
  };
  store.groups.push(group);
  savePermissions(store);
  return group;
}

/** Names of people currently in this group. */
function assignedToGroup(groupId) {
  const names = new Map(listRoster().map((person) => [person.email, person.name]));
  return loadPermissions()
    .members.filter((member) => member.groupId === groupId)
    .map((member) => {
      const named = String(names.get(member.email) || "").trim();
      if (named) return named;
      const parts = nameFromEmail(member.email);
      return [parts.first, parts.last].filter(Boolean).join(" ") || member.email;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * @param {string} groupName
 * @param {string[]} people
 */
function deleteGroupWarning(groupName, people) {
  const risk = `Delete ${groupName}? This group is removed. Everyone assigned to it moves to Everything no FTP and loses this group's access.`;
  if (!people.length) return `${risk}\n\nNo one is assigned to this group.`;
  const lines = people.map((name) => `• ${name}`).join("\n");
  return `${risk}\n\nAssigned to this group:\n${lines}`;
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
 * @param {"menus" | "tools" | "actions"} key
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
 * @param {"menus" | "tools" | "actions"} key
 * @param {string[]} ids
 * @param {boolean} on
 */
/**
 * @param {PermGroup} group
 * @param {"menus" | "tools" | "actions"} key
 * @param {string[]} ids
 * @param {boolean} on
 */
function applyGroupItems(group, key, ids, on) {
  const list = new Set(group[key] || []);
  for (const id of ids) {
    if (on) list.add(id);
    else if (!(group.id === ADMIN_ID && key === "menus" && id === "permissions")) list.delete(id);
  }
  if (group.id === ADMIN_ID && key === "menus") list.add("permissions");
  group[key] = [...list];
}

/**
 * @param {string} groupId
 * @param {"menus" | "tools" | "actions"} key
 * @param {string[]} ids
 * @param {boolean} on
 */
export function toggleGroupItems(groupId, key, ids, on) {
  updateGroup(groupId, (group) => applyGroupItems(group, key, ids, on));
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
/**
 * @param {PermStore} store
 * @param {string} email
 * @param {string} groupId
 * @returns {{ ok: boolean, movedFrom: string, changed: boolean }}
 */
function applyAssign(store, email, groupId) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean || !clean.includes("@") || clean === OWNER_EMAIL) return { ok: false, movedFrom: "", changed: false };
  if (!store.groups.some((group) => group.id === groupId)) return { ok: false, movedFrom: "", changed: false };
  const previous = store.members.find((member) => member.email === clean);
  if (previous?.groupId === groupId) return { ok: true, movedFrom: "", changed: false };
  const fromGroup = previous ? store.groups.find((group) => group.id === previous.groupId) : null;
  const nextGroup = store.groups.find((group) => group.id === groupId);
  const menus = (previous?.menus || []).filter((id) => !nextGroup.menus.includes(id));
  const tools = (previous?.tools || []).filter((id) => !nextGroup.tools.includes(id));
  const actions = (previous?.actions || []).filter((id) => !(nextGroup.actions || []).includes(id));
  store.members = store.members.filter((member) => member.email !== clean);
  store.members.push({ email: clean, groupId, menus, tools, actions });
  store.released = store.released.filter((item) => item !== clean);
  return { ok: true, movedFrom: fromGroup?.name || "", changed: true };
}

/**
 * Put a person in one group. The owner always stays in Admin.
 * @param {string} email
 * @param {string} groupId
 * @returns {{ ok: boolean, movedFrom: string }}
 */
export function assignMember(email, groupId) {
  const store = loadPermissions();
  const result = applyAssign(store, email, groupId);
  if (result.changed) savePermissions(store);
  return { ok: result.ok, movedFrom: result.movedFrom };
}

/** @param {string} email */
/**
 * @param {PermStore} store
 * @param {string} email
 * @returns {boolean}
 */
function applyRemove(store, email) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean || clean === OWNER_EMAIL) return false;
  const had = store.members.some((member) => member.email === clean);
  store.members = store.members.filter((member) => member.email !== clean);
  if (!store.released.includes(clean)) store.released.push(clean);
  return had || store.released.includes(clean);
}

/** @param {string} email */
export function removeMember(email) {
  const store = loadPermissions();
  if (!applyRemove(store, email)) return false;
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
    store.members.push({ email: clean, groupId: STAFF_ID, menus: [], tools: [], actions: [] });
    assigned.add(clean);
    changed = true;
  }
  if (changed) savePermissions(store);
}

/**
 * The group is the starting set. Extra sections on the person are added on top.
 * The owner, and anyone left on Full access, can open every section.
 * @returns {{ menus: Set<string>, tools: Set<string>, actions: Set<string> } | null}
 */
function restrictedGrants() {
  if (getEmail() === OWNER_EMAIL) return null;
  const email = getEmail();
  if (!email) return null;
  const store = loadPermissions();
  const member = store.members.find((item) => item.email === email);
  if (!member) return null;
  const group = store.groups.find((item) => item.id === member.groupId);
  if (!group) return null;
  return {
    menus: new Set([...group.menus, ...member.menus]),
    tools: new Set([...group.tools, ...member.tools]),
    actions: new Set([...(group.actions || []), ...(member.actions || [])]),
  };
}

/** @param {string} view */
export function allowsMenu(view) {
  if (view === "troubleshooting") return true;
  const grants = restrictedGrants();
  if (!grants) return true;
  if (view === FTP_MENU || String(view).startsWith("integrations-ftp")) return grants.menus.has(FTP_MENU);
  if (String(view).startsWith("integrations")) return grants.menus.has("integrations");
  return grants.menus.has(view);
}

/** @param {string} pageId Insights inner page id */
export function allowsInsightPage(pageId) {
  const grants = restrictedGrants();
  if (!grants) return true;
  return grants.menus.has(`insight:${pageId}`);
}

/** @returns {string[]} Insight page ids the current group cannot open. */
export function hiddenInsightPages() {
  if (!restrictedGrants()) return [];
  return INSIGHT_PAGE_IDS.filter((id) => !allowsInsightPage(id));
}

/** @param {string} toolId */
export function allowsTool(toolId) {
  const grants = restrictedGrants();
  if (!grants) return true;
  return grants.tools.has(toolId);
}

/** A popup or button. Page access can stay on when this is off. @param {string} actionId */
export function allowsAction(actionId) {
  const grants = restrictedGrants();
  if (!grants) return true;
  return grants.actions.has(actionId);
}

/** Hide a tool's own buttons when this person cannot use them. @param {ParentNode} root @param {string} scriptPath */
export function gateToolButtons(root, scriptPath) {
  const toolId = scriptPath.split("/").pop()?.replace(/\.js$/i, "") || scriptPath;
  const selectors = {
    run: "[data-run]",
    send: "[data-send]",
    clear: "[data-clear], [data-clear-list], [data-clear-file], [data-clear-map], #nmfc-clear",
    export: "[data-export]",
    delete: "[data-delete-preset], [data-delete]",
    lookup: "[data-search]",
    calculate: "button[type='submit']",
  };
  for (const button of buttonsForTool({ id: toolId, script: scriptPath })) {
    const key = button.id.slice(button.id.lastIndexOf(":") + 1);
    const selector = selectors[key];
    if (!selector || allowsAction(button.id)) continue;
    root.querySelectorAll(selector).forEach((el) => {
      if (el instanceof HTMLElement) el.hidden = true;
    });
  }
}

/**
 * @param {PermStore} store
 * @param {string} email
 * @param {string[]} menuIds
 * @param {string[]} toolIds
 * @param {string[]} actionIds
 * @param {boolean} on
 */
function applyMemberExtras(store, email, menuIds, toolIds, actionIds, on) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean || clean === OWNER_EMAIL) return;
  const member = store.members.find((item) => item.email === clean);
  if (!member) return;
  const group = store.groups.find((item) => item.id === member.groupId);
  const groupMenus = new Set(group?.menus || []);
  const groupTools = new Set(group?.tools || []);
  const groupActions = new Set(group?.actions || []);
  const menus = new Set(member.menus);
  const tools = new Set(member.tools);
  const actions = new Set(member.actions || []);
  for (const id of menuIds) {
    if (groupMenus.has(id)) continue;
    if (on) menus.add(id);
    else menus.delete(id);
  }
  for (const id of toolIds) {
    if (groupTools.has(id)) continue;
    if (on) tools.add(id);
    else tools.delete(id);
  }
  for (const id of actionIds) {
    if (groupActions.has(id)) continue;
    if (on) actions.add(id);
    else actions.delete(id);
  }
  member.menus = [...menus];
  member.tools = [...tools];
  member.actions = [...actions];
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

/** @type {PermStore | null} */
let editorDraft = null;
/** @type {string} */
let editorDraftKey = "";
/** @type {string} */
let editorDraftBase = "";

function clearEditorDraft() {
  editorDraft = null;
  editorDraftKey = "";
  editorDraftBase = "";
}

/** @param {string} id */
function groupIsKnown(id) {
  if (!id) return false;
  if (loadPermissions().groups.some((group) => group.id === id)) return true;
  return editorDraftKey === `group:${id}` && Boolean(editorDraft?.groups.some((group) => group.id === id));
}

/**
 * The group or person open in the editor.
 * @param {PermStore} store
 * @param {PermFocus} focus
 */
function editedRecord(store, focus) {
  if (focus.editor?.kind === "group") return store.groups.find((group) => group.id === focus.editor.id) || null;
  if (focus.editor?.kind === "user") {
    return store.members.find((member) => member.email === focus.editor.email) || null;
  }
  return null;
}

/** @param {PermStore} store @param {PermFocus} focus */
function signatureFor(store, focus) {
  return JSON.stringify(editedRecord(store, focus));
}

/** Hold popup edits until Save. @param {PermFocus} focus */
function ensureEditorDraft(focus) {
  const key = editorKey(focus.editor);
  if (!key) {
    clearEditorDraft();
    return;
  }
  if (editorDraft && editorDraftKey === key) return;
  editorDraft = cloneStore(loadPermissions());
  editorDraftKey = key;
  editorDraftBase = signatureFor(editorDraft, focus);
}

/** @param {PermFocus} focus */
function editorStoreFor(focus) {
  if (editorDraft && editorDraftKey && editorDraftKey === editorKey(focus.editor)) return editorDraft;
  return loadPermissions();
}

/** @param {PermFocus} focus */
function draftIsDirty(focus) {
  return Boolean(editorDraft && editorDraftKey === editorKey(focus.editor) && signatureFor(editorDraft, focus) !== editorDraftBase);
}

/** @param {ParentNode} root @param {PermFocus} focus */
function refreshSaveState(root, focus) {
  const button = root.querySelector("[data-perm-save]");
  if (button instanceof HTMLButtonElement) button.disabled = !draftIsDirty(focus);
}

/** @param {PermFocus} focus @returns {boolean} */
function commitEditorDraft(focus) {
  if (!draftIsDirty(focus) || !editorDraft || !focus.editor) return false;
  const live = loadPermissions();
  if (!hydrated || !viewerCanWrite(live)) return false;
  if (focus.editor.kind === "group") {
    const next = editorDraft.groups.find((group) => group.id === focus.editor.id);
    if (!next) return false;
    const index = live.groups.findIndex((group) => group.id === next.id);
    if (index >= 0) live.groups[index] = next;
    else live.groups.push(next);
  } else {
    const email = focus.editor.email;
    const next = editorDraft.members.find((member) => member.email === email) || null;
    live.members = live.members.filter((member) => member.email !== email);
    if (next) {
      live.members.push(next);
      live.released = live.released.filter((item) => item !== email);
    } else if (!live.released.includes(email)) {
      live.released.push(email);
    }
  }
  savePermissions(live);
  editorDraft = cloneStore(live);
  editorDraftBase = signatureFor(editorDraft, focus);
  return true;
}

/** @param {PermFocus} [focus] */
function focusOf(focus) {
  const groupId = groupIsKnown(focus?.groupId || "") ? focus?.groupId || null : null;
  const userEmail = focus?.userEmail ? String(focus.userEmail).trim().toLowerCase() : null;
  const pick = focus?.pick === "group" || focus?.pick === "user" ? focus.pick : null;
  /** @type {PermEditor | null} */
  let editor = null;
  if (focus?.editor?.kind === "group" && groupIsKnown(focus.editor.id)) {
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

function editorSurface() {
  return document.querySelector(".perm-tile-editor, .perm-modal");
}

function editorScroller() {
  const surface = editorSurface();
  if (!(surface instanceof HTMLElement)) return null;
  const scroller = surface.querySelector(".perm-modal-body");
  return scroller instanceof HTMLElement ? scroller : null;
}

/** @param {PermEditor | null | undefined} editor */
function editorKey(editor) {
  if (!editor) return "";
  return editor.kind === "group" ? `group:${editor.id}` : `user:${editor.email}`;
}

/** Keep scroll and the search box across a redraw of the same screen. @param {PermFocus} [focus] */
function rememberPermUi(focus) {
  const state = focusOf(focus);
  const surface = editorSurface();
  const scroller = editorScroller();
  const key = editorKey(state.editor);
  if (surface instanceof HTMLElement && scroller && key && surface.dataset.permEditor === key) {
    modalScroll = scroller.scrollTop;
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
  const state = focusOf(focus);
  ensureEditorDraft(state);
  rememberPermUi(state);
  const roster = listRoster();
  const store = loadPermissions();
  const editingStore = editorStoreFor(state);
  const names = new Map(roster.map((person) => [person.email, person.name]));
  const memberGroup = new Map(store.members.map((member) => [member.email, member.groupId]));
  const groupName = new Map(store.groups.map((group) => [group.id, group.name]));
  const userRows = roster
    .map((person) => {
      const groupId = memberGroup.get(person.email) || "";
      const label = groupId ? groupName.get(groupId) || "Unknown group" : "Full access";
      const named = splitPersonName(person.name);
      const fromMail = nameFromEmail(person.email);
      const first = named.first || fromMail.first;
      const last = named.last || (named.first ? "" : fromMail.last);
      return `
        <tr data-perm-edit-user="${esc(person.email)}">
          <td class="perm-who">${esc(first)}</td>
          <td class="perm-who">${esc(last)}</td>
          <td class="perm-who perm-mail" title="${esc(person.email)}">${esc(person.email)}</td>
          <td class="perm-group">${esc(label)}</td>
          <td class="perm-row-actions"><button type="button" data-perm-edit-user="${esc(person.email)}">Edit</button></td>
        </tr>`;
    })
    .join("");
  const userBody =
    userRows || `<tr class="perm-empty-row"><td colspan="5">No one to show yet.</td></tr>`;
  const groupsOpen = state.pick === "group" && state.editor?.kind !== "group";
  return `
    <div class="page-canvas perm-page">
      <header class="hero">
        <h1>Permissions</h1>
      </header>
      <p class="perm-hint" id="perm-remote-note"${remoteNote ? "" : " hidden"}>${esc(remoteNote)}</p>
      <section class="perm-card" aria-label="Users">
        <div class="perm-board-head">
          <div>
            <h2>Users</h2>
            <p class="perm-hint">${esc(directoryStatusLine())}</p>
          </div>
          <div class="perm-toolbar">
            ${directoryButton()}
            <button type="button" data-perm-groups>Groups</button>
          </div>
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
      ${groupsOpen ? renderGroupsModal(store) : ""}
      ${state.editor?.kind === "group" ? renderGroupPanel(editingStore, state) : ""}
      ${state.editor?.kind === "user" ? renderUserEditor(editingStore, state, names) : ""}
    </div>`;
}

/**
 * @param {PermStore} store
 */
function renderGroupsModal(store) {
  const rows = store.groups
    .map((group) => {
      const count = store.members.filter((member) => member.groupId === group.id).length;
      const noun = count === 1 ? "person" : "people";
      return `
        <tr data-perm-pick-group="${esc(group.id)}">
          <td class="perm-label" title="${esc(group.name)}">${esc(group.name)}</td>
          <td>${count} ${noun}</td>
          <td class="perm-row-actions"><button type="button" data-perm-edit-group="${esc(group.id)}">Edit</button></td>
        </tr>`;
    })
    .join("");
  return `
    <div class="perm-modal" data-perm-editor="groups" role="dialog" aria-modal="true" aria-label="Groups">
      <div class="perm-modal-backdrop" data-perm-close></div>
      <div class="perm-modal-card">
        <div class="perm-modal-body">
          <div class="perm-editor-head">
            <h2>Groups</h2>
          </div>
          <p class="perm-hint">A group is a starting set of pages and functions. People can be given more when you edit them.</p>
          <div class="perm-board-head">
            <input class="perm-find" type="search" data-perm-find-group placeholder="Find a group" value="${esc(groupsQuery)}" autocomplete="off" />
            <button type="button" class="perm-plus" data-perm-new aria-label="Add group" title="Add group">+</button>
          </div>
          <div class="perm-board-scroll">
            <table class="perm-table perm-board">
              <thead><tr><th>Group</th><th>People</th><th></th></tr></thead>
              <tbody>
                ${rows || `<tr class="perm-empty-row"><td colspan="3">No groups yet.</td></tr>`}
                <tr class="perm-empty-row" data-perm-none-groups hidden><td colspan="3">No groups match.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="perm-modal-foot">
          <div class="perm-modal-foot-actions">
            <button type="button" data-perm-close>Close</button>
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * @param {PermStore} store
 * @param {PermFocus} state
 */
function renderGroupPanel(store, state) {
  if (state.editor?.kind !== "group") return "";
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
      <div class="perm-modal-backdrop" data-perm-close="groups"></div>
      <div class="perm-modal-card">
        <div class="perm-modal-body">
          <div class="perm-editor-head">
            <input class="perm-name" data-perm-name value="${esc(group.name)}" aria-label="Group name" maxlength="60" autocomplete="off" spellcheck="false" />
          </div>
          <p class="perm-hint">${hint}</p>
          <h3 class="perm-section">Pages and functions</h3>
          <div class="perm-tree-wrap"><ul class="perm-tree">${tree}</ul></div>
        </div>
        <div class="perm-modal-foot">
          <button type="button" class="perm-delete" data-perm-delete="${esc(group.id)}" ${isAdmin || isStaff ? "disabled" : ""} title="${deleteTitle}">Delete group</button>
          <div class="perm-modal-foot-actions">
            <button type="button" data-perm-close="groups">Close</button>
            <button type="button" class="perm-save" data-perm-save disabled>Save</button>
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * @param {PermStore} store
 * @param {PermFocus} state
 * @param {Map<string, string>} names
 */
function renderUserEditor(store, state, names) {
  if (state.editor?.kind !== "user") return "";
  const email = state.editor.email;
  const named = splitPersonName(names.get(email) || "");
  const fromMail = nameFromEmail(email);
  const personName = [named.first || fromMail.first, named.last || (named.first ? "" : fromMail.last)].filter(Boolean).join(" ");
  const member = store.members.find((item) => item.email === email);
  const locked = email === OWNER_EMAIL;
  const fullAccess = !member;
  const options = [`<option value=""${!member ? " selected" : ""}>Full access</option>`]
    .concat(
      store.groups.map(
        (group) =>
          `<option value="${esc(group.id)}"${group.id === member?.groupId ? " selected" : ""}>${esc(group.name)}</option>`
      )
    )
    .join("");
  const tree = permissionTree().map((node) => renderTreeNode(node)).join("");
  const hint = locked
    ? "This account can open every page and function."
    : fullAccess
      ? "Full access opens every page and function. Choose a group to limit it, then check anything extra."
      : "Pages and functions from the group stay on. Check more to give them to this person only.";
  return `
    <div class="perm-modal" data-perm-editor="user:${esc(email)}" role="dialog" aria-modal="true" aria-label="${esc(personName || email)}">
      <div class="perm-modal-backdrop" data-perm-close></div>
      <div class="perm-modal-card">
        <div class="perm-modal-body">
          <div class="perm-editor-head">
            <h2>${esc(personName || email)}</h2>
          </div>
          ${personName ? `<p class="perm-hint">${esc(email)}</p>` : ""}
          <label class="perm-field">Group
            <select data-perm-assign="${esc(email)}" aria-label="Group" ${locked ? "disabled" : ""}>${options}</select>
          </label>
          <h3 class="perm-section">Pages and functions</h3>
          <p class="perm-hint">${hint}</p>
          <div class="perm-tree-wrap"><ul class="perm-tree">${tree}</ul></div>
        </div>
        <div class="perm-modal-foot">
          <div class="perm-modal-foot-actions">
            <button type="button" data-perm-close>Close</button>
            <button type="button" class="perm-save" data-perm-save disabled>Save</button>
          </div>
        </div>
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
        <input type="checkbox" data-perm-box data-menus="${esc(grant.menus.join(","))}" data-tools="${esc(grant.tools.join(","))}" data-actions="${esc(grant.actions.join(","))}" ${lockPermissions ? "data-perm-lock" : ""} />
        <span${node.label === "Pop ups and buttons" ? ' class="perm-subhead"' : ""}>${esc(node.label)}</span>
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
  root.querySelectorAll("tr[data-perm-edit-user]").forEach((row) => {
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
function syncGroupLabel(root, groupId, label) {
  const row = root.querySelector(`[data-perm-pick-group="${CSS.escape(groupId)}"]`);
  const cell = row?.querySelector("td");
  if (cell) cell.textContent = label;
  const dialog = editorSurface();
  if (dialog instanceof HTMLElement) dialog.setAttribute("aria-label", label);
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
  ensureEditorDraft(focus);
  const store = editorStoreFor(focus);
  const editing = focus.editor?.kind === "group" ? store.groups.find((group) => group.id === focus.editor.id) : null;
  const editingMember = focus.editor?.kind === "user"
    ? store.members.find((member) => member.email === focus.editor.email) || null
    : null;
  const editingMemberGroup = editingMember
    ? store.groups.find((group) => group.id === editingMember.groupId) || null
    : null;
  const userUnrestricted = focus.editor?.kind === "user" && (focus.editor.email === OWNER_EMAIL || !editingMember);
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
    const card = editorScroller();
    if (same && card instanceof HTMLElement) modalScroll = card.scrollTop;
    else modalScroll = 0;
    if (!same) modalBoxKey = "";
    if (scroller instanceof HTMLElement) peopleScroll = scroller.scrollTop;
    opts.onFocus(focusOf({ ...focus, ...next }));
  };

  root.querySelectorAll("[data-perm-box]").forEach((box) => {
    if (!(box instanceof HTMLInputElement)) return;
    const menus = String(box.dataset.menus || "").split(",").filter(Boolean);
    const tools = String(box.dataset.tools || "").split(",").filter(Boolean);
    const actions = String(box.dataset.actions || "").split(",").filter(Boolean);
    const total = menus.length + tools.length + actions.length;
    if (focus.editor?.kind === "user") {
      if (userUnrestricted) {
        box.checked = true;
        box.indeterminate = false;
        box.disabled = true;
        return;
      }
      const ownedMenus = new Set([...(editingMemberGroup?.menus || []), ...(editingMember?.menus || [])]);
      const ownedTools = new Set([...(editingMemberGroup?.tools || []), ...(editingMember?.tools || [])]);
      const ownedActions = new Set([...(editingMemberGroup?.actions || []), ...(editingMember?.actions || [])]);
      const groupMenus = new Set(editingMemberGroup?.menus || []);
      const groupTools = new Set(editingMemberGroup?.tools || []);
      const groupActions = new Set(editingMemberGroup?.actions || []);
      const on =
        menus.filter((id) => ownedMenus.has(id)).length +
        tools.filter((id) => ownedTools.has(id)).length +
        actions.filter((id) => ownedActions.has(id)).length;
      const fromGroup =
        menus.filter((id) => groupMenus.has(id)).length +
        tools.filter((id) => groupTools.has(id)).length +
        actions.filter((id) => groupActions.has(id)).length;
      const locked = total > 0 && fromGroup === total;
      box.checked = total > 0 && on === total;
      box.indeterminate = !locked && on > 0 && on < total;
      box.disabled = locked;
      box.title = locked ? "Included by the group" : "";
      return;
    }
    if (!editing) return;
    const ownedMenus = new Set(editing.menus);
    const ownedTools = new Set(editing.tools);
    const ownedActions = new Set(editing.actions || []);
    const on =
      menus.filter((id) => ownedMenus.has(id)).length +
      tools.filter((id) => ownedTools.has(id)).length +
      actions.filter((id) => ownedActions.has(id)).length;
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
  const card = editorScroller();
  if (card instanceof HTMLElement) card.scrollTop = modalScroll;
  if (modalBoxKey) {
    const boxKey = modalBoxKey;
    modalBoxKey = "";
    const match = [...root.querySelectorAll("[data-perm-box]")].find(
      (el) => el instanceof HTMLInputElement && `${el.dataset.menus}|${el.dataset.tools}|${el.dataset.actions}` === boxKey
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
  if (focus.editor || focus.pick === "group") {
    permKeyHandler = (event) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".app-dialog:not(.hidden)")) return;
      if (!editorSurface()) return;
      event.preventDefault();
      if (focus.editor?.kind === "group") askClose("groups");
      else askClose("");
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
  root.querySelector("[data-perm-groups]")?.addEventListener("click", () => {
    go({ groupId: null, userEmail: null, pick: "group", editor: null });
  });
  const askClose = (/** @type {string} */ back) => {
    const leave = () => {
      clearEditorDraft();
      if (back === "groups") go({ editor: null, pick: "group", groupId: null, userEmail: null });
      else go({ editor: null, pick: null, groupId: null, userEmail: null });
    };
    if (!draftIsDirty(focus)) {
      leave();
      return;
    }
    void confirmDialog("Close without saving these changes?", {
      title: "Permissions",
      okLabel: "Close",
      cancelLabel: "Keep editing",
    }).then((yes) => {
      if (yes) leave();
    });
  };
  root.querySelectorAll("[data-perm-close]").forEach((el) => {
    el.addEventListener("click", () => {
      askClose(/** @type {HTMLElement} */ (el).dataset.permClose || "");
    });
  });
  root.querySelector("[data-perm-save]")?.addEventListener("click", () => {
    if (!commitEditorDraft(focus)) return;
    go(focus);
  });
  root.querySelector("[data-perm-new]")?.addEventListener("click", () => {
    const live = loadPermissions();
    const group = {
      id: newId(),
      name: "New group",
      menus: [],
      tools: [],
      actions: [],
    };
    const draft = cloneStore(live);
    draft.groups.push(group);
    editorDraft = draft;
    editorDraftKey = `group:${group.id}`;
    editorDraftBase = signatureFor(draft, { groupId: group.id, userEmail: null, pick: "group", editor: { kind: "group", id: group.id } });
    go({ groupId: group.id, userEmail: null, pick: "group", editor: { kind: "group", id: group.id } });
  });
  root.querySelectorAll("[data-perm-pick-group]").forEach((row) => {
    row.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (row).dataset.permPickGroup || "";
      if (!id) return;
      go({ groupId: id, userEmail: null, pick: "group", editor: { kind: "group", id } });
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
    editing.name = trimmed;
    syncGroupLabel(root, editing.id, trimmed);
    refreshSaveState(root, focus);
  };
  name?.addEventListener("input", () => commitName(false));
  name?.addEventListener("change", () => commitName(true));
  root.querySelector("[data-perm-delete]")?.addEventListener("click", () => {
    const btn = root.querySelector("[data-perm-delete]");
    if (!(btn instanceof HTMLButtonElement) || btn.disabled || !editing) return;
    const groupId = editing.id;
    const groupName = editing.name;
    void confirmDialog(deleteGroupWarning(groupName, assignedToGroup(groupId)), {
      title: "Delete group",
      okLabel: "Delete group",
      cancelLabel: "Cancel",
      tone: "danger",
    }).then((yes) => {
      if (!yes) return;
      if (loadPermissions().groups.some((group) => group.id === groupId) && !deleteGroup(groupId)) return;
      clearEditorDraft();
      go({ groupId: null, userEmail: null, pick: "group", editor: null });
    });
  });
  root.querySelectorAll("[data-perm-box]").forEach((box) => {
    box.addEventListener("change", () => {
      if (!(box instanceof HTMLInputElement) || box.disabled) return;
      const menus = String(box.dataset.menus || "").split(",").filter(Boolean);
      const tools = String(box.dataset.tools || "").split(",").filter(Boolean);
      const actions = String(box.dataset.actions || "").split(",").filter(Boolean);
      const menuIds = box.checked ? [...new Set([...menus, ...ancestorMenusFor(menus, tools, actions)])] : menus;
      modalBoxKey = `${box.dataset.menus}|${box.dataset.tools}|${box.dataset.actions}`;
      if (!editorDraft) return;
      if (focus.editor?.kind === "user") {
        const email = focus.editor.email;
        applyMemberExtras(editorDraft, email, menuIds, tools, actions, box.checked);
        go({ editor: { kind: "user", email }, pick: "user", userEmail: email, groupId: focus.groupId });
        return;
      }
      if (!editing) return;
      applyGroupItems(editing, "menus", menuIds, box.checked);
      applyGroupItems(editing, "tools", tools, box.checked);
      applyGroupItems(editing, "actions", actions, box.checked);
      go({ editor: { kind: "group", id: editing.id }, pick: "group", groupId: editing.id, userEmail: null });
    });
  });
  root.querySelector("[data-perm-assign]")?.addEventListener("change", () => {
    const select = root.querySelector("[data-perm-assign]");
    if (!(select instanceof HTMLSelectElement) || select.disabled || focus.editor?.kind !== "user") return;
    const email = focus.editor.email;
    const groupId = select.value;
    if (scroller instanceof HTMLElement) peopleScroll = scroller.scrollTop;
    if (!editorDraft) return;
    if (groupId) applyAssign(editorDraft, email, groupId);
    else applyRemove(editorDraft, email);
    go({
      groupId: groupId || null,
      userEmail: email,
      pick: "user",
      editor: { kind: "user", email },
    });
  });
  if (!allowsAction("permissions:add-group")) {
    root.querySelectorAll("[data-perm-new]").forEach((el) => {
      if (el instanceof HTMLElement) el.hidden = true;
    });
  }
  if (!allowsAction("permissions:delete-group")) {
    const del = root.querySelector("[data-perm-delete]");
    if (del instanceof HTMLElement) del.hidden = true;
  }
  refreshSaveState(root, focus);
  root.querySelector("[data-perm-directory]")?.addEventListener("click", () => {
    const mode = /** @type {HTMLElement} */ (root.querySelector("[data-perm-directory]")).dataset.permDirectory;
    if (mode === "refresh") invalidateDalkoDirectory();
    loadDalkoDirectory(mode === "consent" || mode === "retry");
    go(focus);
  });
}
