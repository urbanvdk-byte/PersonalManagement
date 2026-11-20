import {addDays,dayKey,makeDay} from './date.ts';
import type {EventItem,Task} from './types';

/**
 * "Next day" is relative to the date of the calendar card, not to today's
 * system clock. Moving a card again therefore advances it one more day.
 * Keeping the local HH:mm part avoids UTC/DST date shifts.
 */
export function nextScheduledDay(value:string):string{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))
   throw Error('Сначала назначьте дату и время');
 const current=value.slice(0,10);
 const parsed=makeDay(current);
 if(dayKey(parsed)!==current)throw Error('Некорректная дата задачи');
 return dayKey(addDays(parsed,1))+value.slice(10);
}

export function nextTaskDay(task:Pick<Task,'scheduled_at'>):{scheduled_at:string;status:'planned'}{
 if(!task.scheduled_at)throw Error('Для переноса нужна дата задачи');
 return {scheduled_at:nextScheduledDay(task.scheduled_at),status:'planned'};
}

export function nextEventDay(event:Pick<EventItem,'starts_at'|'ends_at'>):{starts_at:string;ends_at:string}{
 return {
   starts_at:nextScheduledDay(event.starts_at),
   ends_at:nextScheduledDay(event.ends_at)
 };
}
