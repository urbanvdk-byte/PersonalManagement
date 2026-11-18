/**
 * Layout of timed tasks and events in one calendar day.
 * Items that overlap occupy different lanes. Intervals that touch at their
 * endpoints do not overlap. Transitive collision clusters have independent
 * column counts, so unrelated items can use the entire width.
 */
export type TimedInterval={id:string;start:number;end:number};
export type TimedPlacement={
 id:string;column:number;columns:number;span:number;
 leftPercent:number;widthPercent:number;
};
export type TimedLayout={placements:Map<string,TimedPlacement>;maxColumns:number};

const intersects=(a:TimedInterval,b:TimedInterval)=>a.start<b.end&&b.start<a.end;

export function layoutTimedItems(items:readonly TimedInterval[]):TimedLayout{
 const sorted=[...items].filter(item=>Number.isFinite(item.start)&&Number.isFinite(item.end)&&item.end>item.start)
   .sort((a,b)=>a.start-b.start||b.end-a.end||a.id.localeCompare(b.id));
 const placements=new Map<string,TimedPlacement>();
 let maxColumns=1;
 function placeGroup(group:TimedInterval[]){
   if(!group.length)return;
   const columnEnds:number[]=[];
   const positioned=group.map(item=>{
     let column=columnEnds.findIndex(end=>end<=item.start);
     if(column<0){column=columnEnds.length;columnEnds.push(item.end);}
     else columnEnds[column]=item.end;
     return {item,column};
   });
   const columns=columnEnds.length;
   maxColumns=Math.max(maxColumns,columns);
   for(const {item,column} of positioned){
     // An item can fill additional columns when those columns have no
     // simultaneous item. Keep expansion contiguous to avoid collisions.
     let span=1;
     for(let next=column+1;next<columns;next++){
       if(positioned.some(other=>other.column===next&&intersects(item,other.item)))break;
       span++;
     }
     placements.set(item.id,{
       id:item.id,column,columns,span,
       leftPercent:100*column/columns,widthPercent:100*span/columns
     });
   }
 }
 let group:TimedInterval[]=[];
 let groupEnd=-Infinity;
 for(const item of sorted){
   if(group.length&&item.start>=groupEnd){
     placeGroup(group);
     group=[];
     groupEnd=-Infinity;
   }
   group.push(item);
   groupEnd=Math.max(groupEnd,item.end);
 }
 placeGroup(group);
 return {placements,maxColumns};
}
