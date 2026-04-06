export interface Post {
  id: number;
  message: string;
  fingerprint: string;
  owner: string | null;
  timestamp: string;
}

let nextId = 1;
const posts: Post[] = [];

export function addPost(
  message: string,
  fingerprint: string,
  owner: string | null,
): Post {
  const post: Post = {
    id: nextId++,
    message,
    fingerprint,
    owner,
    timestamp: new Date().toISOString(),
  };
  posts.unshift(post);
  return post;
}

export function getPosts(): Post[] {
  return posts;
}
