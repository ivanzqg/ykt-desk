import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialCourseRows,officialCourseDetails} from '../platform-data.mjs';
import {mapCourse,mergeCourse} from '../data.mjs';

test('official classroom cards normalize to dashboard courses without inventing SKU IDs',()=>{
  const [row]=officialCourseRows({list:[{classroom_id:7,name:'班级',role:6,course:{id:8,name:'课程',university_id:91,platform:4}}]});
  const course=mapCourse(row);
  assert.equal(course.id,7);assert.equal(course.courseId,8);assert.equal(course.name,'课程');assert.equal(course.skuId,null);
  assert.equal(course.universityId,91);assert.equal(course.platformId,4);assert.equal(course.auditor,true);
  const metadata=officialCourseDetails(course,{course_id:8,free_sku_id:9,uv_id:91,platform:4,course_sign:'sign'});
  const merged=mergeCourse(course,{metadata,stats:{study_progress:25},todos:[{leaf_id:10,type:0,name:'视频'}]});
  assert.equal(merged.skuId,9);assert.equal(merged.lmsAvailable,true);assert.equal(merged.sign,'sign');assert.equal(merged.tasks[0].id,'7:10');
});
test('missing and duplicate official IDs or unknown response shapes are rejected',()=>{
  assert.throws(()=>officialCourseRows({product_list:[],count:0}),/格式不完整/);
  assert.throws(()=>officialCourseRows({list:[{classroom_id:7,course:{name:'no id'}}]}),/标识/);
  const row={classroom_id:7,course:{id:8}};
  assert.throws(()=>officialCourseRows({list:[row,row]}),/重复/);
  assert.deepEqual(officialCourseRows({list:[]}),[]);
});
test('a classroom without an online SKU is represented explicitly instead of requesting SKU zero',()=>{
  const details=officialCourseDetails({courseId:8,universityId:0,platformId:3},{course_id:8,sku_id:0,free_sku_id:null});
  assert.equal(details.skuId,null);assert.equal(details.lmsAvailable,false);
  assert.equal(officialCourseDetails({courseId:8},{sku_id:9,free_sku_id:10}).skuId,9);
});
