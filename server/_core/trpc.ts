import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { ASSIGNABLE_ROLES, hasAnyRole } from "@shared/roles";
import { isAccountDisabled, isPasswordResetRequired } from "../passwords";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return { ...shape, message: error.code === "INTERNAL_SERVER_ERROR" ? "操作未完成，请联系管理员核查" : shape.message, data: { ...shape.data, stack: undefined } };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (!hasAnyRole(ctx.user, ASSIGNABLE_ROLES)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "账号尚未配置业务角色，请联系管理员" });
  }
  if (isAccountDisabled(ctx.user.password)) throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
  if (isPasswordResetRequired(ctx.user.password) && opts.path !== "auth.changePassword") {
    throw new TRPCError({ code: "FORBIDDEN", message: "请先修改初始或重置密码" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = protectedProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !hasAnyRole(ctx.user, ['admin'])) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
