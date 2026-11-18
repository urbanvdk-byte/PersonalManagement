/** The same task constraints are used by the form and the Pages demo adapter. */
export function isValidTaskDuration(value:unknown):boolean{
  return typeof value==='number' && Number.isInteger(value) &&
    value>=30 && value<=1440 && value%15===0;
}

export function hasScheduledTime(value:unknown):boolean{
  if(typeof value!=='string')return false;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if(!match)return false;
  const [year,month,day,hour,minute]=match.slice(1).map(Number);
  const date=new Date(year,month-1,day,hour,minute);
  return date.getFullYear()===year && date.getMonth()+1===month &&
    date.getDate()===day && date.getHours()===hour && date.getMinutes()===minute;
}
