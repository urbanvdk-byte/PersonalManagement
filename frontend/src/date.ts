export const dayKey=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
export const makeDay=(s:string)=>{const [y,m,d]=s.slice(0,10).split('-').map(Number);return new Date(y,m-1,d)};
export const addDays=(d:Date,n:number)=>{const v=new Date(d);v.setDate(v.getDate()+n);return v};
export const weekStart=(d:Date)=>{const v=new Date(d.getFullYear(),d.getMonth(),d.getDate());v.setDate(v.getDate()-(v.getDay()+6)%7);return v};
export const dateTimeLocal=(d:Date)=>dayKey(d)+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
export const fmtDate=(s:string|Date,opts?:Intl.DateTimeFormatOptions)=>((typeof s==='string')?makeDay(s):s).toLocaleDateString('ru-RU',opts||{day:'numeric',month:'short'});
export const fmtTime=(s:string)=>s.slice(11,16);
export const priorityFlags=(n:number)=>({priority:n,important:n<=2?1:0,urgent:n===1||n===3?1:0});
