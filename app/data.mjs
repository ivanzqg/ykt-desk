export function mapCourse(c) {
  return { id:Number(c.classroom_id), courseId:Number(c.course_id), skuId:Number(c.sku_id), sign:c.course_sign, name:c.course_name, classroomName:c.classroom_name, term:c.classroom_term, auditor:c.role === 6, progress:0, units:{completed:0,total:0}, tasks:[], lastSync:null, error:null };
}
export function mapTask(item, courseId) {
  return { id:`${courseId}:${item.leaf_id}`, courseId:Number(courseId), leafId:Number(item.leaf_id), name:item.name, type:Number(item.type ?? item.leaf_type), deadline:item.score_deadline || null, deadlineTs:item.score_deadline_ts || null, expired:!!item.is_expired, score:!!item.is_score, url:item.link_url || '', status:'pending', progress:Number(item.progress || 0), chapterId:item.chapter_id || null, section:null };
}
export function mergeCourse(course, { stats, todos, chapters }) {
  const pending = todos.map(item => mapTask(item, course.id));
  const byId = new Map(pending.map(item => [item.id,item]));
  for (const chapter of chapters?.course_progress || []) {
    for (const section of chapter.section_leaf_list || []) {
      for (const leaf of section.leaf_list || []) {
        const id = `${course.id}:${leaf.id}`;
        const task = byId.get(id) || { ...mapTask(leaf,course.id), status:leaf.progress >= 1 ? 'completed' : 'unknown' };
        task.chapterId = chapter.id; task.section = section.name; task.progress = Number(leaf.progress || 0);
        task.deadlineTs = leaf.score_deadline || task.deadlineTs;
        byId.set(id,task);
      }
    }
  }
  return { ...course, tasks:[...byId.values()], progress:stats.study_progress || 0, units:stats.unit_progress, counts:stats.unfinished, lastSync:new Date().toISOString(), error:null };
}
