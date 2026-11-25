import {useState} from 'react';
import type {Goal} from './types';

export default function GoalContribution({goal,onDecision}:{goal:Goal;onDecision:(amount:number)=>void}){
 const direction=goal.target_value>=goal.start_value?1:-1;
 const distance=Math.abs(goal.target_value-goal.start_value);
 const qualitative=goal.measurable===0;
 const left=goal.done?0:Math.max(0,(goal.target_value-goal.current_value)*direction);
 const maximum=qualitative?(distance?Math.min(100,left/distance*100):0):left;
 const [input,setInput]=useState('0');
 const number=Number(input);
 const valid=Number.isFinite(number)&&number>=0&&number<=maximum;
 const amount=valid?number:0;
 const next=goal.current_value+direction*(qualitative?amount*distance/100:amount);
 const progress=(value:number)=>goal.done?100:distance?Math.max(0,Math.min(100,Math.round(100*(value-goal.start_value)*direction/distance))):0;
 const format=(value:number)=>Number(value.toFixed(6)).toLocaleString('ru-RU',{maximumFractionDigits:6});
 const unit=qualitative?'п. п.':goal.unit||'ед.';
 return <div className="goal-contribution-overlay">
  <section role="dialog" aria-modal="true" aria-label="Вклад в цель" className="goal-contribution-dialog">
   <h2>Выполнение задачи продвинуло вас к вашей цели?</h2>
   <strong>{goal.title}</strong>
   <p>{qualitative?'Прогресс: '+progress(goal.current_value)+'%':'Текущий показатель: '+format(goal.current_value)+' / '+format(goal.target_value)+' '+unit}</p>
   <label>Насколько продвинулись ({unit})<input aria-label="Ползунок вклада" type="range" min={0} max={maximum} step="any" disabled={maximum===0} value={amount} onChange={e=>setInput(String(Number(Number(e.target.value).toFixed(6))))}/></label>
   <label>Величина вклада<input aria-label="Величина вклада" type="number" inputMode="decimal" min={0} max={maximum} step="any" value={input} onChange={e=>setInput(e.target.value)}/></label>
   <p>После выполнения: {qualitative?progress(next)+'%':format(next)+' '+unit}</p>
   <small>Можно оставить 0 и нажать «ДА», если задача помогла, но показатель ещё не изменился.</small>
   <div className="goal-contribution-actions"><button type="button" className="primary-btn" disabled={!valid} onClick={()=>onDecision(amount)}>ДА</button><button type="button" className="secondary-btn" onClick={()=>onDecision(0)}>НЕТ</button></div>
  </section>
 </div>;
}
