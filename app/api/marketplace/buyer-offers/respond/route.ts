import {
  POST_buyerOfferRespond,
  buyerOfferPublicMethodNotAllowed,
} from "@/lib/marketplace/buyer-offer-public-routes";

export const runtime = "nodejs";
export const POST = POST_buyerOfferRespond;
export const GET = buyerOfferPublicMethodNotAllowed;
export const PUT = buyerOfferPublicMethodNotAllowed;
export const PATCH = buyerOfferPublicMethodNotAllowed;
export const DELETE = buyerOfferPublicMethodNotAllowed;
export const HEAD = buyerOfferPublicMethodNotAllowed;
export const OPTIONS = buyerOfferPublicMethodNotAllowed;
