export function downloadFile(contents:string|Uint8Array,filename:string,mime:string) {
  const blob=new Blob([typeof contents==='string'?contents:contents.slice().buffer],{type:mime});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);
  try {link.click();} finally {link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60_000);}
}
