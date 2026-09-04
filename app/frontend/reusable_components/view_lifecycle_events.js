// view_lifecycle_events.js
// Defines framework-neutral lifecycle signals for reusable application views.
// Bridges navigation containers with floating child surfaces without coupling either component to the other.
// Exists so portalled menus can close when their owner view becomes inactive even though they live under document.body.

export const VIEW_DEACTIVATE_EVENT = "easelect:view-deactivate";
