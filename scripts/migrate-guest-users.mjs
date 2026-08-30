import mongoose from "mongoose";

const uri = process.env.MONGO_URI;
if (!uri) throw new Error("必须配置 MONGO_URI 才能执行游客账号索引迁移");

try {
  await mongoose.connect(uri, { autoIndex: false });
  const users = mongoose.connection.collection("users");
  await users.createIndex({ email: 1 }, {
    name: "member_email_unique",
    unique: true,
    partialFilterExpression: { email: { $type: "string" } },
  });
  await users.createIndex({ guestLinkId: 1 }, {
    name: "guest_link_user_unique",
    unique: true,
    partialFilterExpression: { guestLinkId: { $type: "objectId" } },
  });
  const indexes = await users.indexes();
  if (indexes.some((index) => index.name === "email_1")) {
    await users.dropIndex("email_1");
  }
  const completed = await users.indexes();
  if (!completed.some((index) => index.name === "member_email_unique" && index.unique)
    || !completed.some((index) => index.name === "guest_link_user_unique" && index.unique)
    || completed.some((index) => index.name === "email_1")) {
    throw new Error("游客账号索引迁移校验失败");
  }
  console.log("游客账号索引迁移完成：普通用户邮箱保持唯一，每条访问链接仅关联一个游客身份。");
} finally {
  await mongoose.disconnect();
}
