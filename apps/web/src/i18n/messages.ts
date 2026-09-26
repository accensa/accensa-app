import enCommon from './messages/en/common.json';
import enCheckout from './messages/en/checkout.json';
import enMerchant from './messages/en/merchant.json';
import esCommon from './messages/es/common.json';
import esCheckout from './messages/es/checkout.json';
import esMerchant from './messages/es/merchant.json';
import frCommon from './messages/fr/common.json';
import frCheckout from './messages/fr/checkout.json';
import frMerchant from './messages/fr/merchant.json';
import ptCommon from './messages/pt/common.json';
import ptCheckout from './messages/pt/checkout.json';
import ptMerchant from './messages/pt/merchant.json';

export const resources = {
  en: { common: enCommon, checkout: enCheckout, merchant: enMerchant },
  es: { common: esCommon, checkout: esCheckout, merchant: esMerchant },
  fr: { common: frCommon, checkout: frCheckout, merchant: frMerchant },
  pt: { common: ptCommon, checkout: ptCheckout, merchant: ptMerchant },
} as const;
