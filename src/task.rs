use anyhow::Result;

use crate::ws;

pub struct Task {
    def: ws::Task,
    cfg: ws::Config,
}

impl Task {
    pub fn run(&self) -> Result<()> {
        todo!()
    }
}
