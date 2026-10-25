'use client';

import { useI18n } from "@/lib/client/i18n";
import UsersPanel from '@/app/components/settings/panels/UsersPanel';
export default function UsersPage() {
  const { t } = useI18n();
  
 return <><header className="admin-page-heading"><h1>{t("用户管理", "Users")}</h1><p>{t("管理花卷的账号、访问权限与用量。", "Manage Huajuan accounts, access, and usage.")}</p></header><UsersPanel /></>; }
