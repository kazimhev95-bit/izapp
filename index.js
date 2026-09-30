// Arka plan konum görevi, arayüzden ÖNCE tanımlanmalı (iOS uygulamayı arka planda uyandırınca
// yalnız bu giriş dosyası çalışır).
import './src/tracker';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
