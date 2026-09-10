import mongoose from 'mongoose';
import YAML from 'yaml';
import UserSettings from '@/models/UserSettings';
import Conversation from '@/models/Conversation';
import WorkbenchSkill from '@/models/WorkbenchSkill';
import { DEFAULT_ASSISTANT, DEFAULT_APPEARANCE, DEFAULT_PERMISSIONS } from '@/lib/shared/preferences.mjs';

export async function migrateUserCapabilities() {
  const migrations = mongoose.connection.collection('settings_migrations');
  if (await migrations.findOne({_id:'capabilities-v1'})) return;
  for (const [field,value] of Object.entries({assistant:DEFAULT_ASSISTANT,appearance:DEFAULT_APPEARANCE,permissions:DEFAULT_PERMISSIONS,skillsInitialized:false})) {
    await UserSettings.updateMany({[field]:{$exists:false}},{$set:{[field]:value}});
  }
  await Conversation.updateMany({'settings.memoryEnabled':{$exists:false}},{$set:{'settings.memoryEnabled':true}});
  await Conversation.updateMany({'settings.disabledSkillIds':{$exists:false}},{$set:{'settings.disabledSkillIds':[]}});
  for await (const skill of WorkbenchSkill.find({}).cursor()) {
    if (!/^---\r?\n/.test(skill.content)) skill.content = `---\n${YAML.stringify({name:skill.name,description:skill.description})}---\n${skill.content}`;
    await skill.save();
  }
  await migrations.updateOne({_id:'capabilities-v1'},{$setOnInsert:{completedAt:new Date()}},{upsert:true});
}
