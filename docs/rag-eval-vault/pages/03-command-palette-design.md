# Command Palette 설계

- command palette는 command 전용 창이 아니라 global launcher처럼 동작해야 한다.
- note search와 command search를 한 인터페이스에서 처리하는 편이 user-friendly하다.
- `>` prefix는 command-only filter로 충분하다.
- 관련 문서: [[주간 sync 2026-02-08]], [[검색 품질 회고]], [[개인 검색 마찰 메모]].

## 빈 상태

- recent notes
- common commands
- recent searches는 제외

## 결과 레이아웃

- title: 작은 볼드
- snippet: 일반 텍스트
- breadcrumb: 작은 일반 텍스트

## 이동 원칙

- block jump가 기본
- page jump는 block jump의 부분집합
