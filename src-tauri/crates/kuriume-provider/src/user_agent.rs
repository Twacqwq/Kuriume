/// Catalog requests identify the app, its version and its home, as Bangumi's
/// API guidelines ask (generic library agents may be blocked).
pub(crate) const USER_AGENT: &str = concat!(
    "Twacqwq/Kuriume/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/Twacqwq/Kuriume)"
);
