import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';
import './demo-banner.css';
import './theme.css';
import './light-theme.css';
import './offline.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

// Cached app shell can reopen without a network after its first successful visit.
if('serviceWorker' in navigator && window.isSecureContext){
 window.addEventListener('load',()=>{
  void navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js',{
   scope:import.meta.env.BASE_URL
  }).catch(error=>console.warn('Offline shell unavailable:',error));
 });
}
