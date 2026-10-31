#!/bin/sh
# Rebuilds the engine from Ferrum's crates/calc (the checkout this one lives in, ../../.., or $FERRUM)
# whenever it changes: the generated ferrum_calc.js and ferrum_calc_bg.wasm are committed, so
# interfaces build without Rust. Needs the wasm32-unknown-unknown target and wasm-bindgen-cli at the
# version Ferrum's Cargo.lock pins (cargo install wasm-bindgen-cli --version <it>).
set -e
here=$(cd "$(dirname "$0")" && pwd)
ferrum=${FERRUM:-$here/../../..}
target=${CARGO_TARGET_DIR:-$ferrum/target}
(cd "$ferrum" && cargo rustc -q -p ferrum-calc --release --features wasm --target wasm32-unknown-unknown --crate-type cdylib)
wasm-bindgen --target web --out-dir "$here/src" --out-name ferrum_calc "$target/wasm32-unknown-unknown/release/ferrum_calc.wasm"
