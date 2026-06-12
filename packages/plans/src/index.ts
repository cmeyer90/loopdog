// @looper/plans — the durable plan store: portable format, issue<->plan
// binding, lifecycle automation, and index maintenance (M04).
export {
  appendToSection,
  checkItem,
  getHeaderField,
  getSection,
  parsePlan,
  serializePlan,
  setHeaderField,
  setStatus,
  updateSection,
} from './format/plan-doc.js';
export type { PlanDoc } from './format/plan-doc.js';
export {
  FORMAT_VERSION,
  MILESTONE_TEMPLATE,
  STORE_LAYOUT,
  TASK_TEMPLATE,
  assertSupportedFormatVersion,
  renderTemplate,
} from './format/templates.js';
export { RepoPlanStoreFiles, slugify } from './store/repo-plan-store.js';
export { RepoPlanStore } from './store/plan-store-port.js';
export {
  bindIssue,
  parsePlanMarker,
  reconcileBinding,
  renderPlanMarker,
  resolveBinding,
} from './binding/binding.js';
export type { Binding } from './binding/binding.js';
export { archivePlan, openPlan, updatePlan, verifyPlan } from './lifecycle/lifecycle.js';
export { projectIndexes, rebuildIndexes, updateIndexesFor } from './index-maintenance/project.js';
