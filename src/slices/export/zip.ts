/** Small, dependency-free ZIP writer using stored (uncompressed) entries. */
const table=Uint32Array.from({length:256},(_,n)=>{
  let value=n;for(let i=0;i<8;i++) value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
export function crc32(bytes:Uint8Array):number {
  let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;
}
export function zipFiles(files:{name:string;contents:string}[]):Uint8Array {
  if(files.length>65535)throw new Error('Too many files for this archive.');
  const encoder=new TextEncoder(),names=new Set<string>();
  const entries=files.map(f=>{
    if(!f.name||f.name.includes('/')||f.name.includes('\\')||f.name.includes('\0')||names.has(f.name))throw new Error('Invalid or duplicate export filename.');
    names.add(f.name);const name=encoder.encode(f.name),data=encoder.encode(f.contents);
    if(name.length>65535)throw new Error('Export filename is too long.');
    return{name,data,crc:crc32(data)};
  });
  const size=entries.reduce((n,e)=>n+30+e.name.length+e.data.length+46+e.name.length,22);
  if(size>100*1024*1024)throw new Error('The export exceeds 100 MB. Download sheets individually or simplify the model.');
  const output=new Uint8Array(size),view=new DataView(output.buffer);
  let offset=0;
  const records:{offset:number;entry:typeof entries[number]}[]=[];
  for(const e of entries) {
    records.push({offset,entry:e});
    view.setUint32(offset,0x04034b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,0x800,true);
    view.setUint16(offset+12,33,true); // 1980-01-01, deterministic archive date.
    view.setUint32(offset+14,e.crc,true);view.setUint32(offset+18,e.data.length,true);view.setUint32(offset+22,e.data.length,true);view.setUint16(offset+26,e.name.length,true);
    output.set(e.name,offset+30);output.set(e.data,offset+30+e.name.length);offset+=30+e.name.length+e.data.length;
  }
  const central=offset;
  for(const {offset:local,entry:e} of records) {
    view.setUint32(offset,0x02014b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,20,true);view.setUint16(offset+8,0x800,true);view.setUint16(offset+14,33,true);
    view.setUint32(offset+16,e.crc,true);view.setUint32(offset+20,e.data.length,true);view.setUint32(offset+24,e.data.length,true);view.setUint16(offset+28,e.name.length,true);view.setUint32(offset+42,local,true);
    output.set(e.name,offset+46);offset+=46+e.name.length;
  }
  view.setUint32(offset,0x06054b50,true);view.setUint16(offset+8,entries.length,true);view.setUint16(offset+10,entries.length,true);
  view.setUint32(offset+12,offset-central,true);view.setUint32(offset+16,central,true);
  return output;
}
