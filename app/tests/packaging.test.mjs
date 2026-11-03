import {test} from 'node:test';
import assert from 'node:assert/strict';
import {removePeSignature} from '../../scripts/pe-signature.mjs';

function pe() {
  const file=Buffer.alloc(1024);
  file.writeUInt16LE(0x5a4d,0);file.writeUInt32LE(128,0x3c);
  file.writeUInt32LE(0x00004550,128);file.writeUInt16LE(0x20b,152);
  const security=152+112+32;
  file.writeUInt32LE(960,security);file.writeUInt32LE(64,security+4);
  file.fill(0x8f,960);return {file,security};
}
test('only the copied PE signature is removed and the input stays intact',()=>{
  const {file,security}=pe();const changed=removePeSignature(file);
  assert.equal(changed.length,960);assert.equal(changed.readUInt32LE(security),0);
  assert.equal(file.length,1024);assert.equal(file.readUInt32LE(security),960);
});
test('invalid certificate ranges fail closed before producing an output',()=>{
  const {file,security}=pe();file.writeUInt32LE(5000,security);
  assert.throws(()=>removePeSignature(file),/范围无效/);
});
