import React from 'react';
const permission=[{action:'plugin::pod-orders.read',subject:null}];
const Icon=()=> <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 5h16v15H4zM8 2v6m8-6v6M8 12h8m-8 4h5"/></svg>;
export default {register(app){
  app.addMenuLink({to:'plugins/pod-orders',icon:Icon,intlLabel:{id:'pod-orders.name',defaultMessage:'POD orders'},
    Component:()=>import('./OrderPage.jsx'),permissions:permission});
  app.registerPlugin({id:'pod-orders',name:'POD orders'});
}};
