"use client";

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import Link from '../layout/NavigationMotion';
import HuajuanMascot from '../common/HuajuanMascot';
import { useI18n } from '@/lib/client/i18n';
import styles from './HelpCenter.module.css';

function articleText(article, t) {
  return [article.title, ...article.paragraphs, ...(article.steps ?? []), ...(article.note ? [article.note] : [])]
    .map(text => t(...text)).join(' ');
}

export default function HelpCenter({ sections, initialSection, isAdmin, returnTo }) {
  const { t, locale, setLocale } = useI18n();
  const params = useSearchParams();
  const selectedId = params.get('section') ?? initialSection;
  const current = sections.find(section => section.id === selectedId);
  const [query, setQuery] = useState('');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const contentRef = useRef(null);
  const headingRef = useRef(null);
  const focusOnChange = useRef(false);
  const searchInput = useRef(null);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const results = searching ? sections.flatMap(section => section.articles
    .filter(article => {
      const text = `${t(...section.title)} ${articleText(article, t)}`.toLowerCase();
      return terms.every(term => text.includes(term));
    }).map(article => ({ section, article }))) : [];
  const groups = [
    ...(isAdmin ? [{ label: t('管理指南', 'Admin guide'), items: sections.filter(section => section.id.startsWith('admin-')) }] : []),
    { label: t('使用指南', 'User guide'), items: sections.filter(section => !section.id.startsWith('admin-')) },
  ];

  const sectionHref = (id, articleId) => {
    const search = new URLSearchParams({ section: id });
    if (returnTo !== '/') search.set('returnTo', returnTo);
    return `/help?${search}${articleId ? `#${articleId}` : ''}`;
  };

  const selectSection = (event, id, articleId = null) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, '', sectionHref(id, articleId));
    focusOnChange.current = true;
    setQuery('');
    setDirectoryOpen(false);
    if (id === selectedId && !searching) {
      const target = articleId ? document.getElementById(articleId) : headingRef.current;
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
      focusOnChange.current = false;
    }
  };

  useEffect(() => {
    if (searching) return;
    const articleId = window.location.hash.slice(1);
    const target = articleId ? document.getElementById(articleId) : headingRef.current;
    if (articleId) target?.scrollIntoView({ block: 'start' });
    else contentRef.current.scrollTop = 0;
    if (focusOnChange.current && target) {
      target.focus({ preventScroll: true });
      focusOnChange.current = false;
    }
  }, [selectedId, searching]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href={returnTo} className={styles.backLink} aria-label={returnTo.startsWith('/media') ? t('返回媒体创作', 'Back to Media studio') : t('返回对话', 'Back to chat')}>
          <ArrowLeft size={18} /><span>{returnTo.startsWith('/media') ? t('返回媒体创作', 'Back to Media studio') : t('返回对话', 'Back to chat')}</span>
        </Link>
        <div className={styles.pageTitle}><BookOpen size={19} aria-hidden="true" /><h1>{t('帮助文档', 'Help docs')}</h1></div>
        <button type="button" className={styles.language} onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')} lang={locale === 'zh' ? 'en' : 'zh'} aria-label={t('切换为 English', 'Switch to 中文')}>
          {locale === 'zh' ? 'English' : '中文'}
        </button>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.searchBox} role="search">
            <Search size={17} aria-hidden="true" />
            <input ref={searchInput} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('搜索帮助文档', 'Search help docs')} aria-label={t('搜索帮助文档', 'Search help docs')} />
            {query && <button type="button" aria-label={t('清空搜索', 'Clear search')} onClick={() => { setQuery(''); searchInput.current.focus(); }}><X size={16} /></button>}
          </div>
          <button type="button" className={styles.directoryToggle} aria-expanded={directoryOpen} aria-controls="help-directory" onClick={() => setDirectoryOpen(open => !open)}>
            <span>{t('目录', 'Contents')}</span><span className={styles.directoryCurrent}>{t(...current.title)}</span><ChevronDown size={17} className={directoryOpen ? styles.chevronOpen : ''} />
          </button>
          <nav id="help-directory" aria-label={t('帮助目录', 'Help topics')} className={`${styles.directory} ${directoryOpen ? styles.directoryOpen : ''}`}>
            {groups.map(group => <div key={group.label} className={styles.navGroup}>
              <p>{group.label}</p>
              {group.items.map(section => <a key={section.id} href={sectionHref(section.id)} onClick={event => selectSection(event, section.id)} aria-current={!searching && section.id === selectedId ? 'page' : undefined}>
                <span>{t(...section.title)}</span><ChevronRight size={14} aria-hidden="true" />
              </a>)}
            </div>)}
          </nav>
        </aside>

        <main ref={contentRef} className={styles.content}>
          <div className={styles.reading}>
            {searching ? <>
              <header className={`${styles.resultsHeading} ${styles.intro}`}>
                <div className={styles.introCopy}><h2>{t('搜索结果', 'Search results')}</h2>
                <p role="status">{results.length ? t('找到 {count} 篇相关说明', results.length === 1 ? '{count} matching article' : '{count} matching articles', { count: results.length }) : t('没有找到相关说明。试试“图片”“文件”这样的功能名称。', 'No articles match. Try a feature name such as “images” or “files”.')}</p></div>
                <HuajuanMascot variant="help" size={76} />
              </header>
              <div className={styles.results}>
                {results.map(({ section, article }) => <a key={article.id} href={sectionHref(section.id, article.id)} onClick={event => selectSection(event, section.id, article.id)}>
                  <span className={styles.resultSection}>{t(...section.title)}</span>
                  <h3>{t(...article.title)}</h3>
                  <p>{t(...article.paragraphs[0])}</p>
                  <ChevronRight size={18} aria-hidden="true" />
                </a>)}
              </div>
            </> : <>
              <header className={styles.intro}>
                <div className={styles.introCopy}>
                  <p className={styles.guideLabel}>{current.id.startsWith('admin-') ? t('管理员指南', 'Admin guide') : t('使用指南', 'User guide')}</p>
                  <h2 ref={headingRef} tabIndex={-1}>{t(...current.title)}</h2>
                  <p className={styles.summary}>{t(...current.summary)}</p>
                </div>
                <HuajuanMascot variant="help" size={96} />
              </header>
              <nav className={styles.articleDirectory} aria-label={t('本节内容', 'In this topic')}>
                {current.articles.map(article => <a key={article.id} href={`#${article.id}`}>{t(...article.title)}</a>)}
              </nav>
              {current.articles.map(article => <article key={article.id} id={article.id} tabIndex={-1} className={styles.article}>
                <h3>{t(...article.title)}</h3>
                {article.paragraphs.map((paragraph, index) => <p key={index}>{t(...paragraph)}</p>)}
                {article.steps && <ol>{article.steps.map((step, index) => <li key={index}>{t(...step)}</li>)}</ol>}
                {article.note && <aside className={styles.note}>{t(...article.note)}</aside>}
                {article.action && <Link href={article.action.href} className={styles.action}>{t(...article.action.label)}<ChevronRight size={16} aria-hidden="true" /></Link>}
              </article>)}
            </>}
          </div>
        </main>
      </div>
    </div>
  );
}
