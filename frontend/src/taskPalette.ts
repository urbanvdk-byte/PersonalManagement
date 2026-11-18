export const TASK_COLORS = [
  {name:'Синий',hex:'#3466d9'},
  {name:'Голубой',hex:'#16a2dc'},
  {name:'Бирюзовый',hex:'#12aaa1'},
  {name:'Зелёный',hex:'#39aa6f'},
  {name:'Жёлтый',hex:'#e4b636'},
  {name:'Оранжевый',hex:'#ff963b'},
  {name:'Красный',hex:'#e7635e'},
  {name:'Фиолетовый',hex:'#9463d6'}
] as const;
export const DEFAULT_TASK_COLOR = TASK_COLORS[0].hex;
export const PRIORITY_COLORS = ['#e2514b','#ff963b','#3166cf','#8f9dae'] as const;
export const AREA_EMOJIS=['💼','🏠','💰','❤️','🏃','📚','👨‍👩‍👧','🛒','🚗','🎨','🧭','🛠️','💻','✈️','🌱','📅'] as const;
export const areaEmoji = (value?:string|null) => value?.trim() || '📁';
export const taskColor = (value?:string|null) => TASK_COLORS.find(item=>item.hex.toLowerCase()===value?.toLowerCase())?.hex || DEFAULT_TASK_COLOR;
