import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Env } from "../../worker-configuration";
import type * as schema from "../db/schema";
import type { DbUser, DbHousehold } from "../db/schema";

export type Db = DrizzleD1Database<typeof schema>;

export type AppContext = {
  Bindings: Env;
  Variables: {
    db: Db;
    user: DbUser;
    household: DbHousehold;
  };
};
