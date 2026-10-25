'use client';
import { useI18n } from '@/lib/client/i18n';
import {useState} from 'react';
import {Users} from 'lucide-react';
import UserManagementModal from '../UserManagementModal';
import {Action,Section} from '../SettingsUI';
export default function UsersPanel() {
  const { t } = useI18n();

  const [open,setOpen]=useState(false);
  return <><Section title={t("平台用户", "Platform users")} description={t("查看账号、重置密码，以及删除不再使用的账号。", "View accounts, reset passwords, and delete unused accounts.")}><Action primary onClick={()=>setOpen(true)}><Users size={16}/>{t("管理用户", "Manage users")}</Action></Section><UserManagementModal open={open} onClose={()=>setOpen(false)}/></>;
}
