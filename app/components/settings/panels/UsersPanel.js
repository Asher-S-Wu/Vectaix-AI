'use client';
import {useState} from 'react';
import {Users} from 'lucide-react';
import UserManagementModal from '../UserManagementModal';
import {Action,Section} from '../SettingsUI';
export default function UsersPanel() {
  const [open,setOpen]=useState(false);
  return <><Section title="平台用户" description="查看账号、重置密码，以及删除不再使用的账号。"><Action primary onClick={()=>setOpen(true)}><Users size={16}/>管理用户</Action></Section><UserManagementModal open={open} onClose={()=>setOpen(false)}/></>;
}
