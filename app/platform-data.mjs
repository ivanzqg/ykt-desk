export const OFFICIAL_CATALOG = '/v2/api/web/courses/list?identity=2';

function positiveId(value) {
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>0 ? number : null;
}
export function officialCourseRows(data) {
  if(!Array.isArray(data?.list))throw new Error('雨课堂版课程列表格式不完整，请刷新或更新插件');
  // The student index renders data.list directly: each item is one classroom.
  const ids=new Set();
  return data.list.map(row=>{
    const classroomId=positiveId(row.classroom_id),courseId=positiveId(row.course?.id||row.course_id);
    if(!classroomId||!courseId||ids.has(classroomId))throw new Error('雨课堂版课程标识缺失或重复，请刷新课程列表');
    ids.add(classroomId);
    return {
      classroom_id:classroomId,course_id:courseId,course_name:row.course?.name||row.course_name||row.name||'未命名课程',
      classroom_name:row.name||'',course_sign:row.course_sign||'',
      classroom_term:Number(row.classroom_term||row.term?.id||0),role:row.role,
      sku_id:positiveId(row.sku_id||row.free_sku_id),
      university_id:positiveId(row.course?.university_id||row.university_id)||0,platform_id:positiveId(row.course?.platform||row.platform_id)||3,
      source:'official',
    };
  });
}
export function officialCourseDetails(course,data) {
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('雨课堂版课程详情格式不完整');
  const courseId=positiveId(data.course_id)||course.courseId;
  const skuId=positiveId(data.sku_id||data.free_sku_id);
  if(!courseId)throw new Error('雨课堂版课程详情缺少课程标识');
  return {
    courseId,skuId,universityId:positiveId(data.uv_id||data.university_id)||course.universityId||0,
    platformId:positiveId(data.platform||data.platform_id)||course.platformId||3,
    sign:data.course_sign||course.sign||'',lmsAvailable:skuId!==null,
  };
}
