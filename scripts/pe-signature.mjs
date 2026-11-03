// SEA changes the Node binary, so its upstream Authenticode signature no longer
// applies. Remove that signature directory from the copied build output before
// injection. The original Node installation is never written.
export function removePeSignature(input) {
  const bytes=Buffer.from(input);
  if(bytes.length<64 || bytes.readUInt16LE(0)!==0x5a4d)throw new Error('不是有效的 PE 文件');
  const pe=bytes.readUInt32LE(0x3c);
  if(pe+24>bytes.length || bytes.readUInt32LE(pe)!==0x00004550)throw new Error('无效的 PE 头');
  const optional=pe+24;
  const magic=bytes.readUInt16LE(optional);
  const directories=magic===0x20b?optional+112:magic===0x10b?optional+96:null;
  if(directories===null)throw new Error('不支持的 PE 可选头');
  const entry=directories+4*8;
  if(entry+8>bytes.length)throw new Error('PE 证书目录超出文件范围');
  const offset=bytes.readUInt32LE(entry), size=bytes.readUInt32LE(entry+4);
  if(size===0)return bytes;
  if(offset===0 || offset<entry+8 || offset+size>bytes.length)throw new Error('PE 证书表范围无效');
  bytes.writeUInt32LE(0,entry);bytes.writeUInt32LE(0,entry+4);
  if(offset+size===bytes.length)return bytes.subarray(0,offset);
  bytes.fill(0,offset,offset+size);
  return bytes;
}
