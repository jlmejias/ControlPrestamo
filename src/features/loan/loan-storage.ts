import type {LoanState} from './loan-types';
export const KEY='control-prestamo:v1';
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export const initialState:LoanState={version:1,config:{principal:34509726.97,annualRate:8,years:30,startDate:localToday(),strategy:'recalculate'},payments:[]};
export const loadState=():LoanState=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')||initialState}catch{return initialState}};
export const saveState=(s:LoanState)=>localStorage.setItem(KEY,JSON.stringify(s));
