const STATUSES = new Set(['pending', 'in_progress', 'completed']);

export function validatePlan(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 12) throw new Error('计划需要包含 1 到 12 个步骤');
  const ids = new Set();
  let active = 0;
  const plan = steps.map(step => {
    if (!step || typeof step.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(step.id) || ids.has(step.id)) throw new Error('计划步骤编号无效或重复');
    if (typeof step.title !== 'string' || !step.title.trim() || step.title.length > 200) throw new Error('计划步骤需要填写 200 字以内的标题');
    if (!STATUSES.has(step.status)) throw new Error('计划步骤状态无效');
    ids.add(step.id);
    if (step.status === 'in_progress') active++;
    return { id: step.id, title: step.title.trim(), status: step.status };
  });
  if (active > 1) throw new Error('每次集中执行一个计划步骤');
  return plan;
}

export function contextBudget(model) {
  const reserve = Math.min(model.maxOutputTokens, Math.max(1024, Math.floor(model.contextWindow * 0.2)));
  return Math.max(1024, Math.floor((model.contextWindow - reserve) * 0.8));
}
