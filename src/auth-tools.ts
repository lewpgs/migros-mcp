/**
 * Barrel re-exports for the authenticated tool surface. The actual code is
 * split by domain into ./auth-tools/{account,cart,orders,cumulus}.ts to
 * keep each file focused and easy to scan.
 */
export { getProfile, getAddresses } from "./auth-tools/account.js";
export {
  getBasket,
  addToBasket,
  updateBasketQuantity,
  removeFromBasket,
  getCheckoutLink,
} from "./auth-tools/cart.js";
export { getOrders, getOrderDetails } from "./auth-tools/orders.js";
export {
  getCumulusStatus,
  getInStoreReceipts,
  getReceiptDetails,
  getCumulusCoupons,
} from "./auth-tools/cumulus.js";
